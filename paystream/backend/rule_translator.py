"""
Translates natural language merchant rules into a structured JSON object
for display on the setup screen. This JSON is NOT used for runtime evaluation
— the payment_agent sends the original rule_text to Haiku each interval.
"""
import boto3
import json
import os
import re
from dotenv import load_dotenv

load_dotenv()

REGION = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")

SYSTEM_PROMPT = """Convert merchant payment rules into structured JSON for display.
Output ONLY valid JSON, no explanation, no markdown.

Output format:
{"condition_metric": "charge_rate", "operator": "lt", "threshold": <number>, "action": "pause" | "reduce", "reduce_by_percent": <number or null>, "unit": "kW"}

Examples:
Input: "pause payment if charge rate drops below 20kW"
Output: {"condition_metric": "charge_rate", "operator": "lt", "threshold": 20, "action": "pause", "reduce_by_percent": null, "unit": "kW"}

Input: "reduce payment by 50% if speed is below 5 Mbps"
Output: {"condition_metric": "speed_mbps", "operator": "lt", "threshold": 5, "action": "reduce", "reduce_by_percent": 50, "unit": "Mbps"}"""


def translate_for_display(rule_text: str) -> dict:
    try:
        return _call_bedrock(rule_text)
    except Exception as e:
        print(f"[rule_translator] Bedrock failed, using regex fallback: {e}")
        return _regex_fallback(rule_text)


def _call_bedrock(rule_text: str) -> dict:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 200,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": rule_text}],
        }),
    )
    raw = json.loads(response["body"].read())["content"][0]["text"].strip()
    # Strip any accidental markdown code fences
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    return json.loads(raw)


def _regex_fallback(rule_text: str) -> dict:
    lower = rule_text.lower()
    action = "reduce" if "reduce" in lower else "pause"
    m_threshold = re.search(r"(\d+(?:\.\d+)?)\s*kw", lower)
    m_reduce = re.search(r"(\d+(?:\.\d+)?)\s*%", lower)
    threshold = float(m_threshold.group(1)) if m_threshold else 20.0
    reduce_by = float(m_reduce.group(1)) if m_reduce else None
    return {
        "condition_metric": "charge_rate",
        "operator": "lt",
        "threshold": threshold,
        "action": action,
        "reduce_by_percent": reduce_by,
        "unit": "kW",
    }
