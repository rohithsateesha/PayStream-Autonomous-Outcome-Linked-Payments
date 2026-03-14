"""
Session Chat — lets the user ask natural language questions about a running
or completed payment session.  Bedrock (Claude Haiku) generates the answer;
a keyword fallback keeps the feature working without AWS credentials.
"""
import boto3
import json
import os
import re
from dotenv import load_dotenv

load_dotenv()

REGION   = os.getenv("AWS_REGION", "ap-south-1")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")


SYSTEM_PROMPT = """You are a helpful assistant embedded in PayStream, an autonomous
outcome-linked payment system.  You have access to the session's payment events
(charges, pauses, incidents, etc.).  Answer the user's question about the session
concisely and accurately.  If the data doesn't contain the answer, say so.
Keep answers under 3 sentences."""


def chat(session_id: str, message: str, events: list, history: list | None = None) -> str:
    """Return an AI response about the session."""
    summary = _build_session_summary(events)
    try:
        return _call_bedrock(message, summary, history or [])
    except Exception as e:
        print(f"[session_chat] Bedrock failed, using keyword fallback: {e}")
        return _keyword_fallback(message, events, summary)


# ── Bedrock call ──────────────────────────────────────────────────────────────

def _call_bedrock(message: str, summary: dict, history: list) -> str:
    bedrock = boto3.client("bedrock-runtime", region_name=REGION)

    messages = []
    for h in history[-6:]:  # keep last 6 turns to stay under token limit
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({
        "role": "user",
        "content": f"Session data:\n{json.dumps(summary, indent=2)}\n\nQuestion: {message}",
    })

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 300,
            "system": SYSTEM_PROMPT,
            "messages": messages,
        }),
    )
    raw = json.loads(response["body"].read())["content"][0]["text"].strip()
    return raw


# ── Keyword fallback ──────────────────────────────────────────────────────────

def _keyword_fallback(message: str, events: list, summary: dict) -> str:
    lower = message.lower()
    payment_events = [e for e in events if "action_taken" in e]
    charged = [e for e in payment_events if e.get("action_taken") == "charged"]
    paused  = [e for e in payment_events if e.get("action_taken") == "paused"]
    total   = sum(e.get("amount_charged", 0) for e in payment_events)

    if "total" in lower or "how much" in lower or "charged" in lower:
        return f"Total charged so far: ₹{total:.2f} across {len(payment_events)} intervals ({len(charged)} charged, {len(paused)} paused)."

    if "pause" in lower or "why" in lower or "stop" in lower:
        if paused:
            last = paused[-1]
            return f"Payment was paused because: {last.get('reason', 'threshold breach')}. The metric was {last.get('metric_value', last.get('charge_rate', '?'))} {last.get('unit', 'kW')}."
        return "No payments have been paused in this session."

    if "incident" in lower:
        incidents = [e for e in events if e.get("type") == "incident_declared"]
        return f"{len(incidents)} incident(s) declared in this session." if incidents else "No incidents in this session."

    if "summar" in lower:
        return (
            f"Session has {len(payment_events)} intervals: "
            f"{len(charged)} charged (₹{sum(e.get('amount_charged',0) for e in charged):.2f}), "
            f"{len(paused)} paused. Total billed: ₹{total:.2f}."
        )

    if "rule" in lower or "require" in lower:
        return f"The active rule requires the service metric to stay above the configured threshold. Breaching it triggers a pause or reduction in payment."

    return f"Session has {len(payment_events)} payment intervals so far. ₹{total:.2f} total charged. Ask me something more specific!"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_session_summary(events: list) -> dict:
    payment_events = [e for e in events if "action_taken" in e]
    charged = [e for e in payment_events if e.get("action_taken") == "charged"]
    paused  = [e for e in payment_events if e.get("action_taken") == "paused"]
    reduced = [e for e in payment_events if e.get("action_taken") == "reduced"]
    incidents = [e for e in events if e.get("type") == "incident_declared"]

    return {
        "total_intervals": len(payment_events),
        "charged": len(charged),
        "paused": len(paused),
        "reduced": len(reduced),
        "incidents": len(incidents),
        "total_billed": round(sum(e.get("amount_charged", 0) for e in payment_events), 2),
        "last_event": payment_events[-1] if payment_events else None,
    }
