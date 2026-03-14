"""
Generates the end-of-session settlement report and dispute evidence package.
Calls Haiku to produce a plain-English explanation of what was charged,
what fell short, and why payment was withheld. Also generates a formal
Service Quality Breach Notice that the merchant can submit to the charger operator.
"""
import boto3
import json
import os
import re
from datetime import datetime, timezone
from dotenv import load_dotenv
from pinelabs_client import create_settlement_order

load_dotenv()

REGION = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")


def generate_settlement(session_id: str, events: list) -> dict:
    charged = [e for e in events if e["action_taken"] == "charged"]
    paused  = [e for e in events if e["action_taken"] == "paused"]
    reduced = [e for e in events if e["action_taken"] == "reduced"]

    total_possible = len(events) * (events[0]["amount_charged"] if charged else 5.0)
    # Recalculate total_possible as if every interval was fully charged
    amount_per_interval = next(
        (e["amount_charged"] for e in charged), 5.0
    )
    total_possible = len(events) * amount_per_interval
    total_billed   = sum(e["amount_charged"] for e in events)
    withheld       = round(total_possible - total_billed, 2)

    summary = {
        "session_id": session_id,
        "total_intervals": len(events),
        "charged_intervals": len(charged),
        "paused_intervals": len(paused),
        "reduced_intervals": len(reduced),
        "total_billed_inr": round(total_billed, 2),
        "amount_withheld_inr": withheld,
        "degradation_samples": [
            {"elapsed_s": e.get("elapsed_seconds"), "charge_rate_kW": e["charge_rate"]}
            for e in paused[:5]
        ],
    }

    try:
        explanation = _call_bedrock(summary)
    except Exception as e:
        print(f"[settlement_engine] Bedrock failed, using template: {e}")
        explanation = _template_explanation(summary)

    # Create Pine Labs order for the verified billed amount
    pine_order_id = None
    pine_order_status = None
    pine_mock = False
    try:
        pine_result = create_settlement_order(session_id, round(total_billed, 2))
        pine_order_id = pine_result.get("order_id")
        pine_order_status = pine_result.get("status")
        pine_mock = pine_result.get("mock", False)
        print(f"[settlement_engine] Pine Labs order {pine_order_id} created for Rs{total_billed:.2f}")
    except Exception as e:
        print(f"[settlement_engine] Pine Labs order creation failed: {e}")

    return {
        "session_id": session_id,
        "total_billed": round(total_billed, 2),
        "total_possible": round(total_possible, 2),
        "amount_withheld": withheld,
        "charged_intervals": len(charged),
        "paused_intervals": len(paused),
        "reduced_intervals": len(reduced),
        "explanation": explanation,
        "pine_labs_order_id": pine_order_id,
        "pine_labs_order_status": pine_order_status,
        "pine_labs_mock": pine_mock,
    }


def _call_bedrock(summary: dict) -> str:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    prompt = (
        "Generate a 2-3 sentence settlement explanation for a merchant.\n"
        f"Session data: {json.dumps(summary)}\n"
        "Be specific with numbers. State what was delivered, what fell short, and what was withheld."
    )
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}],
        }),
    )
    return json.loads(response["body"].read())["content"][0]["text"].strip()


def _template_explanation(s: dict) -> str:
    if s["paused_intervals"] == 0:
        return (
            f"Your charger delivered consistent performance across all {s['total_intervals']} intervals. "
            f"Full payment of ₹{s['total_billed_inr']:.2f} was processed. No amount was withheld."
        )
    return (
        f"Your charger met the required charge rate for {s['charged_intervals']} of {s['total_intervals']} intervals "
        f"(₹{s['total_billed_inr']:.2f} charged). "
        f"During {s['paused_intervals']} intervals the charge rate dropped below your threshold — "
        f"₹{s['amount_withheld_inr']:.2f} was withheld automatically."
    )


# ── Feature 3: Autonomous Dispute Evidence Package ───────────────────────────

def generate_dispute_package(session_id: str, events: list, rule_text: str) -> dict:
    """
    Feature 3: When payment was withheld, the agent proactively generates a
    formal Service Quality Breach Notice — going beyond what the merchant asked for.
    This document can be submitted to the charger operator or a dispute body.
    """
    payment_events = [e for e in events if "action_taken" in e]
    paused_events  = [e for e in payment_events if e["action_taken"] == "paused"]
    charged_events = [e for e in payment_events if e["action_taken"] == "charged"]

    total_possible = len(payment_events) * 5.0
    total_billed   = sum(e["amount_charged"] for e in payment_events)
    total_withheld = round(total_possible - total_billed, 2)
    delivery_pct   = round((len(charged_events) / max(len(payment_events), 1)) * 100, 1)

    try:
        document = _call_bedrock_dispute(
            session_id, rule_text, payment_events, paused_events,
            total_withheld, delivery_pct
        )
    except Exception as e:
        print(f"[settlement_engine] Dispute Bedrock failed, using template: {e}")
        document = _template_dispute(
            session_id, rule_text, paused_events, total_withheld, delivery_pct
        )

    return {
        "session_id": session_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "violations_count": len(paused_events),
        "total_withheld": total_withheld,
        "delivery_percent": delivery_pct,
        "document": document,
    }


def _call_bedrock_dispute(
    session_id: str, rule_text: str, all_events: list,
    paused_events: list, total_withheld: float, delivery_pct: float
) -> str:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)

    violation_timeline = [
        {
            "elapsed_s": e.get("elapsed_seconds"),
            "charge_rate_kW": e["charge_rate"],
            "amount_withheld_inr": 5.0 - e["amount_charged"],
        }
        for e in paused_events[:8]
    ]

    prompt = f"""Generate a formal Service Quality Breach Notice for an EV charging session.

Session details:
- Session ID: {session_id}
- Date: {datetime.now(timezone.utc).strftime("%B %d, %Y")}
- Payment contract: "{rule_text}"
- Total intervals: {len(all_events)} ({len(all_events) * 5} seconds)
- Service delivery: {delivery_pct}% of contracted quality met
- Total amount withheld: ₹{total_withheld:.2f}
- Violation timeline: {json.dumps(violation_timeline)}

Write a professional formal notice with exactly these sections:
1. SERVICE QUALITY BREACH NOTICE (header with session ID and date)
2. CONTRACTED TERMS (the agreed payment terms)
3. PERFORMANCE RECORD (what was delivered vs contracted, with specific numbers and timestamps)
4. FINANCIAL IMPACT (itemised amounts withheld and why)
5. REMEDY REQUESTED (specific action required from the service provider)

Use formal business language. Reference actual numbers from the data. Be concise but complete."""

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 600,
            "messages": [{"role": "user", "content": prompt}],
        }),
    )
    return json.loads(response["body"].read())["content"][0]["text"].strip()


def _template_dispute(
    session_id: str, rule_text: str, paused_events: list,
    total_withheld: float, delivery_pct: float
) -> str:
    date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    violations = "\n".join(
        f"  - t={e.get('elapsed_seconds', '?')}s: {e['charge_rate']} kW delivered (payment withheld: ₹{5.0 - e['amount_charged']:.2f})"
        for e in paused_events[:6]
    )
    return f"""SERVICE QUALITY BREACH NOTICE
Session ID: {session_id}
Date: {date_str}

CONTRACTED TERMS
Payment contract: "{rule_text}"
Agreed: Full payment (₹5.00/interval) when quality threshold is met.

PERFORMANCE RECORD
Service delivery rate: {delivery_pct}% of contracted quality
Quality violations: {len(paused_events)} intervals below contracted threshold

Violation timeline:
{violations}

FINANCIAL IMPACT
Total amount withheld due to quality failures: ₹{total_withheld:.2f}
Basis: Payment withheld only for intervals where service fell below contracted standard.

REMEDY REQUESTED
1. Acknowledge the service quality failures documented above.
2. Review charger maintenance to prevent recurrence.
3. Confirm the withheld amount of ₹{total_withheld:.2f} is accepted as fair settlement.

This notice was generated autonomously by PayStream on behalf of the merchant.
All data is timestamped and independently verifiable."""
