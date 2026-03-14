"""
Feature 2: Incident classification and escalating response.

When 3+ consecutive payment pauses occur, the agent upgrades from
"pausing" to "declaring a formal incident". It classifies severity,
assesses the situation holistically, and recommends a course of action.

A rule engine applies the same response to every threshold breach.
This agent reasons about patterns and escalates proportionally.
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


def declare_incident(session_id: str, history: list, events: list) -> dict:
    """
    Called when 3+ consecutive pauses are detected.
    Haiku assesses the full situation and classifies the incident.
    """
    paused_events = [e for e in events if e["action_taken"] == "paused"]
    recent_rates = [round(h["charge_rate"], 1) for h in history[-6:]]
    estimated_impact = round(len(paused_events) * 5.0, 2)

    try:
        decision = _call_bedrock(paused_events, recent_rates, estimated_impact)
    except Exception as e:
        print(f"[incident_manager] Bedrock failed, using fallback: {e}")
        decision = _fallback_declare(paused_events, estimated_impact)

    return {
        "type": "incident_declared",
        "session_id": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": decision["severity"],
        "assessment": decision["assessment"],
        "recommended_action": decision["recommended_action"],
        "estimated_impact_inr": decision["estimated_impact_inr"],
        "consecutive_pauses": len(paused_events),
    }


def resolve_incident(session_id: str, history: list, incident_start_time: str) -> dict:
    """
    Called when charging recovers after a declared incident.
    """
    recent_rates = [round(h["charge_rate"], 1) for h in history[-3:]]
    return {
        "type": "incident_resolved",
        "session_id": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": (
            f"Charge rate recovered to {recent_rates[-1] if recent_rates else '?'} kW. "
            "Resuming full payment. Incident has been logged for settlement."
        ),
        "recovery_rate_kw": recent_rates[-1] if recent_rates else None,
    }


def _call_bedrock(paused_events: list, recent_rates: list, estimated_impact: float) -> dict:
    prompt = f"""An EV charging session has experienced sustained quality degradation.

Situation:
- Consecutive payment pauses: {len(paused_events)}
- Recent charge rates (kW): {recent_rates}
- Estimated financial impact: ₹{estimated_impact:.2f}
- Charge rates during paused intervals: {[round(e["charge_rate"], 1) for e in paused_events]}

As an autonomous payment agent, classify this incident and recommend a response.

Severity guide:
- minor: 3-4 consecutive pauses, modest rate drop
- major: 5-7 consecutive pauses or rate drop >30% below threshold
- critical: 8+ consecutive pauses or charger appears to have stopped

Respond ONLY with valid JSON, no markdown:
{{
  "severity": "minor" | "major" | "critical",
  "assessment": "one sentence describing what is happening and why",
  "recommended_action": "continue_monitoring" | "request_termination",
  "estimated_impact_inr": {estimated_impact}
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
    result["estimated_impact_inr"] = estimated_impact  # always use computed value
    return result


def _fallback_declare(paused_events: list, estimated_impact: float) -> dict:
    count = len(paused_events)
    if count >= 8:
        severity = "critical"
        assessment = "Charger appears to have stopped delivering power — sustained critical failure detected."
    elif count >= 5:
        severity = "major"
        assessment = f"Charger has delivered below-threshold power for {count} consecutive intervals — major service degradation."
    else:
        severity = "minor"
        assessment = f"Charger underperforming for {count} consecutive intervals - minor but sustained quality drop."

    return {
        "severity": severity,
        "assessment": assessment,
        "recommended_action": "continue_monitoring",
        "estimated_impact_inr": estimated_impact,
    }
