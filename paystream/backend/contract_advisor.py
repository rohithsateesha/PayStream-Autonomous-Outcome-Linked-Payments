"""
Contract Advisor — recommends payment rules for a given industry scenario.
Bedrock (Claude Haiku) generates tailored advice; per-scenario fallbacks
keep the feature working without AWS credentials.
"""
import boto3
import json
import os
import re
from dotenv import load_dotenv

load_dotenv()

REGION   = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")


SYSTEM_PROMPT = """You are a payment contract advisor for PayStream.
Given a scenario (industry) and optional user context, recommend a payment rule,
threshold, and payment action.  Also provide reasoning, risk factors, alternatives, and a tip.

Output ONLY valid JSON with this structure:
{
  "recommended_rule": "<rule text>",
  "recommended_threshold": <number>,
  "threshold_unit": "<unit>",
  "payment_action": "pause" | "reduce",
  "reasoning": "<why this rule>",
  "risk_factors": ["<risk 1>", "<risk 2>"],
  "alternatives": [{"rule": "<alt rule>", "description": "<why>"}],
  "tips": "<pro tip>"
}"""


# ── Per-scenario fallback data ────────────────────────────────────────────────

FALLBACK = {
    "ev": {
        "recommended_rule": "pause payment if charge rate drops below 20kW",
        "recommended_threshold": 20,
        "threshold_unit": "kW",
        "payment_action": "pause",
        "reasoning": "20kW is the industry standard minimum for Level 2 DC fast charging. Below this rate, the charger is delivering significantly less energy than advertised, and the session will take much longer than expected.",
        "risk_factors": [
            "Battery state-of-charge above 80% naturally reduces charge rate — this is normal, not a service failure",
            "Extreme temperatures can temporarily reduce charge rates",
        ],
        "alternatives": [
            {"rule": "reduce payment by 50% if charge rate drops below 15kW", "description": "More lenient — allows slower charging but at a discount"},
            {"rule": "pause payment if charge rate drops below 25kW", "description": "Stricter — ensures near-peak charging speed"},
        ],
        "tips": "Consider using a time-based rule for overnight charging where slower rates are acceptable.",
    },
    "cloud": {
        "recommended_rule": "reduce payment by 50% if API latency exceeds 500ms",
        "recommended_threshold": 500,
        "threshold_unit": "ms",
        "payment_action": "reduce",
        "reasoning": "500ms is a standard SLA threshold for production APIs. Exceeding it degrades user experience significantly. A 50% reduction incentivizes the provider to fix the issue without fully cutting payment.",
        "risk_factors": [
            "Cold starts can cause temporary latency spikes that aren't true service degradation",
            "Geographic routing can affect latency — ensure monitoring is from the same region",
        ],
        "alternatives": [
            {"rule": "pause payment if API latency exceeds 1000ms", "description": "Only penalize severe outages"},
            {"rule": "reduce payment by 25% if API latency exceeds 300ms", "description": "Tighter SLA for latency-sensitive apps"},
        ],
        "tips": "Use P95 latency instead of average for more meaningful SLA enforcement.",
    },
    "delivery": {
        "recommended_rule": "pause payment if delivery time exceeds 45 minutes",
        "recommended_threshold": 45,
        "threshold_unit": "min",
        "payment_action": "pause",
        "reasoning": "45 minutes is a reasonable delivery window for most last-mile services. Exceeding it typically indicates a logistics failure.",
        "risk_factors": [
            "Traffic and weather conditions are outside the courier's control",
            "Restaurant preparation time can delay the delivery start",
        ],
        "alternatives": [
            {"rule": "reduce payment by 30% if delivery time exceeds 30 minutes", "description": "Tighter window with partial penalty"},
            {"rule": "pause payment if delivery time exceeds 60 minutes", "description": "More lenient for longer-distance deliveries"},
        ],
        "tips": "Factor in distance when setting thresholds — a 10km delivery naturally takes longer than 2km.",
    },
    "solar": {
        "recommended_rule": "reduce payment by 30% if power output drops below 5kW",
        "recommended_threshold": 5,
        "threshold_unit": "kW",
        "payment_action": "reduce",
        "reasoning": "5kW is a reasonable minimum for a residential solar installation during peak hours. A 30% reduction balances fair payment with the reality that cloud cover is intermittent.",
        "risk_factors": [
            "Cloud cover and seasonal changes naturally affect output",
            "Panel degradation over time is expected and should be factored into contracts",
        ],
        "alternatives": [
            {"rule": "pause payment if power output drops below 3kW", "description": "Only penalize significant underperformance"},
            {"rule": "reduce payment by 50% if power output drops below 7kW", "description": "Stricter for premium installations"},
        ],
        "tips": "Use daily energy totals (kWh) rather than instantaneous power for fairer assessment.",
    },
    "freelance": {
        "recommended_rule": "pause payment if milestone completion rate drops below 80%",
        "recommended_threshold": 80,
        "threshold_unit": "%",
        "payment_action": "pause",
        "reasoning": "80% milestone completion is a reasonable threshold that accounts for minor delays while ensuring meaningful progress. Below this, the project is likely falling behind schedule.",
        "risk_factors": [
            "Scope changes can affect completion rates without being the freelancer's fault",
            "Quality reviews may delay milestone sign-off",
        ],
        "alternatives": [
            {"rule": "reduce payment by 40% if milestone completion rate drops below 70%", "description": "Partial payment for partial work"},
            {"rule": "pause payment if milestone completion rate drops below 90%", "description": "Strict deadline enforcement"},
        ],
        "tips": "Define milestones clearly upfront and include a dispute resolution process in the contract.",
    },
}


def recommend(scenario: str, context: str = "") -> dict:
    """Return a contract recommendation for the given scenario."""
    try:
        result = _call_bedrock(scenario, context)
        result["source"] = "bedrock"
        return result
    except Exception as e:
        print(f"[contract_advisor] Bedrock failed, using fallback: {e}")
        fb = FALLBACK.get(scenario, FALLBACK["ev"]).copy()
        fb["source"] = "fallback"
        return fb


# ── Bedrock call ──────────────────────────────────────────────────────────────

def _call_bedrock(scenario: str, context: str) -> dict:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)

    user_msg = f"Scenario: {scenario}"
    if context:
        user_msg += f"\nAdditional context: {context}"

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 500,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_msg}],
        }),
    )
    raw = json.loads(response["body"].read())["content"][0]["text"].strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    return json.loads(raw)
