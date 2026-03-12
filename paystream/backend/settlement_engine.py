"""
Generates the end-of-session settlement report.
Calls Haiku to produce a plain-English explanation of what was charged,
what fell short, and why payment was withheld.
"""
import boto3
import json
import os
import re
from dotenv import load_dotenv

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

    return {
        "session_id": session_id,
        "total_billed": round(total_billed, 2),
        "total_possible": round(total_possible, 2),
        "amount_withheld": withheld,
        "charged_intervals": len(charged),
        "paused_intervals": len(paused),
        "reduced_intervals": len(reduced),
        "explanation": explanation,
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
