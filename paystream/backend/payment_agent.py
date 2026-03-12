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

AGENT_SYSTEM = """You are an autonomous payment agent for a real-time EV charging session.
You receive the merchant's payment rule and the last few telemetry readings.
Decide what payment action to take for THIS interval.

Respond ONLY with valid JSON — no explanation, no markdown:
{
  "action": "charge",
  "reduce_by_percent": null,
  "reason": "one concise sentence explaining your decision"
}

Valid actions: "charge" | "pause" | "reduce"
- charge: service is meeting quality standards, charge the full amount
- pause: service quality has fallen below the merchant's threshold, withhold payment
- reduce: service is partially degraded, charge a reduced amount
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

    user_msg = (
        f'Merchant rule: "{rule_text}"\n\n'
        f"Recent telemetry (oldest → newest):\n"
        + json.dumps(
            [
                {
                    "charge_rate_kW": r["charge_rate"],
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

    return {
        "session_id": session_id,
        "timestamp": telemetry["timestamp"],
        "elapsed_seconds": telemetry.get("elapsed_seconds", 0),
        "charge_rate": telemetry["charge_rate"],
        "kwh_delivered": telemetry.get("kwh_delivered", 0),
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
    m = re.search(r"(\d+(?:\.\d+)?)\s*kw", lower)
    threshold = float(m.group(1)) if m else 20.0
    rate = telemetry["charge_rate"]

    if rate < threshold:
        return {
            "action": "pause",
            "reduce_by_percent": None,
            "reason": f"Charge rate {rate} kW is below your {threshold} kW threshold - pausing payment.",
        }
    return {
        "action": "charge",
        "reduce_by_percent": None,
        "reason": f"Charge rate {rate} kW meets your {threshold} kW threshold.",
    }
