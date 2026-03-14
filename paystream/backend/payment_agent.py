"""
The core autonomous payment agent.

Each telemetry interval:
1. Fetches the merchant's rule text
2. Sends last 5 telemetry readings + rule to Claude Haiku
3. Haiku decides: charge | pause | reduce  (with a plain-English reason)
4. Executes the Pine Labs payment call
5. Returns the event dict (including Haiku's reason — shown live in the UI)
"""
import boto3
import json
import os
import re
from dotenv import load_dotenv
from dynamo_client import get_rule_text
from pinelabs_client import charge_micro_payment, pause_payment

load_dotenv()

REGION = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")

AGENT_SYSTEM = """You are an autonomous payment agent enforcing outcome-linked payment contracts in real-time.
You receive the merchant's rule and recent telemetry readings.
Decide what payment action to take for THIS interval.

Respond ONLY with valid JSON — no explanation, no markdown:
{
  "action": "charge",
  "reduce_by_percent": null,
  "reason": "one concise sentence — reference the actual metric value, trend if visible, and why you made this call"
}

Valid actions: "charge" | "pause" | "reduce"
- charge: service meets the contracted standard — authorise full payment
- pause: service has fallen below threshold — withhold payment until quality recovers
- reduce: partial degradation — charge proportionally to quality delivered

Write the reason as an intelligent agent would: reference actual numbers, note trends across the recent readings, and be specific about what the contract requires. Never write generic text.
"""


def evaluate_telemetry(
    session_id: str,
    merchant_id: str,
    telemetry: dict,
    history: list,
    amount_per_interval: float,
) -> dict:
    rule_text = get_rule_text(merchant_id)
    recent = (history[-4:] + [telemetry]) if history else [telemetry]

    metric_key = telemetry.get("metric_key", "charge_rate")
    unit = telemetry.get("unit", "kW")

    user_msg = (
        f'Merchant rule: "{rule_text}"\n\n'
        f"Recent telemetry (oldest -> newest):\n"
        + json.dumps(
            [
                {
                    f"{metric_key}_{unit}": r.get(metric_key),
                    "elapsed_s": r.get("elapsed_seconds", "?"),
                }
                for r in recent
            ],
            indent=2,
        )
        + "\n\nWhat payment action should I take right now?"
    )

    try:
        decision = _call_bedrock(user_msg)
    except Exception as e:
        print(f"[payment_agent] Bedrock failed, using fallback: {e}")
        decision = _fallback_evaluate(rule_text, telemetry)

    action = decision.get("action", "charge")
    reason = decision.get("reason", "")

    if action == "pause":
        pay_result = pause_payment(session_id)
        amount = 0.0
    elif action == "reduce":
        pct = decision.get("reduce_by_percent") or 50
        pay_result = charge_micro_payment(session_id, amount_per_interval, reduce_by=pct)
        amount = round(amount_per_interval * (1 - pct / 100), 2)
    else:
        pay_result = charge_micro_payment(session_id, amount_per_interval)
        amount = amount_per_interval

    metric_value = telemetry.get(metric_key)

    return {
        "session_id": session_id,
        "timestamp": telemetry["timestamp"],
        "elapsed_seconds": telemetry.get("elapsed_seconds", 0),
        # Generic fields for multi-scenario support
        "metric_key": metric_key,
        "metric_value": metric_value,
        "unit": unit,
        # charge_rate kept as fallback for backward compat (EV scenario value or generic)
        "charge_rate": telemetry.get("charge_rate", metric_value),
        "action_taken": action,
        "amount_charged": amount,
        "reason": reason,
        "payment_result": pay_result,
    }


def _call_bedrock(user_msg: str) -> dict:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 150,
            "system": AGENT_SYSTEM,
            "messages": [{"role": "user", "content": user_msg}],
        }),
    )
    raw = json.loads(response["body"].read())["content"][0]["text"].strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    return json.loads(raw)


def _fallback_evaluate(rule_text: str, telemetry: dict) -> dict:
    """Deterministic fallback if Bedrock is unavailable."""
    lower = rule_text.lower()
    metric_key = telemetry.get("metric_key", "charge_rate")
    metric_value = telemetry.get(metric_key, 0)
    unit = telemetry.get("unit", "kW")

    # Extract threshold number from rule text
    m = re.search(r"(\d+(?:\.\d+)?)", lower)
    threshold = float(m.group(1)) if m else 20.0

    # Detect direction: latency/delivery time are bad when HIGH
    degraded_is_high = any(w in lower for w in ["exceeds", "above", "over", "more than"])
    is_degraded = (metric_value > threshold) if degraded_is_high else (metric_value < threshold)

    # Detect reduce vs pause from rule text
    action = "pause"
    reduce_pct = None
    m_reduce = re.search(r"reduce\s+(?:payment\s+)?(?:by\s+)?(\d+)%", lower)
    if m_reduce:
        action = "reduce"
        reduce_pct = int(m_reduce.group(1))

    scenario = telemetry.get("scenario", "ev")

    if is_degraded:
        if degraded_is_high:
            reason = _BREACH_REASONS_HIGH.get(scenario, f"Service breach detected at {metric_value} {unit} — exceeding your {threshold} {unit} limit. Withholding payment until quality recovers.")
        else:
            reason = _BREACH_REASONS_LOW.get(scenario, f"Service underperforming at {metric_value} {unit} — below contracted {threshold} {unit}. Withholding payment.")
        return {"action": action, "reduce_by_percent": reduce_pct, "reason": reason.format(v=metric_value, t=threshold, u=unit)}
    else:
        reason = _OK_REASONS.get(scenario, f"Service performing within contracted parameters at {metric_value} {unit}. Authorising full payment.")
        return {"action": "charge", "reduce_by_percent": None, "reason": reason.format(v=metric_value, t=threshold, u=unit)}


_OK_REASONS = {
    "ev":       "Charging at {v} kW — well above your {t} kW threshold. Authorising full interval payment.",
    "cloud":    "API responding at {v} ms — latency within your {t} ms SLA. Service contracted, charging in full.",
    "delivery": "On-time tracking at {v} min — within your {t}-minute delivery window. Releasing payment.",
    "solar":    "Panel output at {v} kW — contracted generation target met. Charging full interval amount.",
    "freelance": "Completion rate at {v}% — above your {t}% milestone threshold. Payment released.",
}

_BREACH_REASONS_HIGH = {
    "cloud":    "API latency spiked to {v} ms — your {t} ms SLA is breached. Withholding payment until latency recovers.",
    "delivery": "Delivery tracking at {v} min — your {t}-minute window exceeded. Payment withheld pending delivery.",
}

_BREACH_REASONS_LOW = {
    "ev":       "Charge rate dropped to {v} kW — below your contracted {t} kW minimum. Pausing payment until power recovers.",
    "solar":    "Panel output fell to {v} kW — contracted {t} kW not being met. Reducing payment proportionally.",
    "freelance": "Completion rate at {v}% — below your {t}% milestone threshold. Payment paused pending progress.",
}
