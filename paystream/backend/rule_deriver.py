"""
Feature 1: Agent derives its own payment rule by observing baseline performance.

Instead of requiring the merchant to write a rule, the agent watches the first
3 telemetry readings (~15 seconds), determines what 'normal' looks like for
THIS specific charger, and proposes a fair threshold at 90% of observed baseline.

This is something only an LLM can do — a rule engine needs the rule pre-defined.
"""
import boto3
import json
import os
import re
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

REGION = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")


def derive_rule_from_baseline(initial_readings: list) -> dict:
    """
    Takes the first 3 telemetry readings, calls Haiku to derive a fair threshold.
    Returns a proposed rule with reasoning.
    """
    try:
        return _call_bedrock(initial_readings)
    except Exception as e:
        print(f"[rule_deriver] Bedrock failed, using fallback: {e}")
        return _fallback_derive(initial_readings)


def _call_bedrock(readings: list) -> dict:
    simplified = [
        {"charge_rate_kW": r["charge_rate"], "elapsed_s": r.get("elapsed_seconds", "?")}
        for r in readings
    ]
    avg = round(sum(r["charge_rate"] for r in readings) / len(readings), 1)

    prompt = f"""You are observing the first readings of an EV charging session to establish a baseline.

Telemetry readings (first {len(readings)} intervals):
{json.dumps(simplified, indent=2)}

Observed average charge rate: {avg} kW

Your task: Determine a fair payment threshold for the merchant.
- Set the threshold at approximately 90% of the observed baseline
- Round to the nearest whole number for clarity
- Explain your reasoning in one sentence

Respond ONLY with valid JSON, no markdown:
{{
  "observed_avg_kw": {avg},
  "proposed_threshold_kw": <number>,
  "rule_text": "pause payment if charge rate drops below X kW",
  "reasoning": "one sentence explaining why this threshold is fair"
}}"""

    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}],
        }),
    )
    raw = json.loads(response["body"].read())["content"][0]["text"].strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    result = json.loads(raw)
    result["observed_avg_kw"] = avg  # always use the computed value
    return result


def _fallback_derive(readings: list) -> dict:
    avg = round(sum(r["charge_rate"] for r in readings) / len(readings), 1)
    threshold = round(avg * 0.9)
    return {
        "observed_avg_kw": avg,
        "proposed_threshold_kw": threshold,
        "rule_text": f"pause payment if charge rate drops below {threshold} kW",
        "reasoning": f"Threshold set at 90% of observed baseline ({avg} kW) to allow normal variance while catching genuine underperformance.",
    }
