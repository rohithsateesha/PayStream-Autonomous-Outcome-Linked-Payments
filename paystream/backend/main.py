import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional

from models import RuleRequest, SessionRequest
from rule_translator import translate_for_display
from rule_deriver import derive_rule_from_baseline
from dynamo_client import save_rule, get_rule_text
from ev_simulator import simulate_service_session_async, simulate_ev_session_async
from payment_agent import evaluate_telemetry
from settlement_engine import generate_settlement, generate_dispute_package
from incident_manager import declare_incident, resolve_incident
# ── Grafana/Prometheus (optional — install prometheus-client to enable) ───────
try:
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    from metrics import update_metrics, increment_incident, clear_session_metrics
    METRICS_ENABLED = True
except ImportError:
    METRICS_ENABLED = False
    def update_metrics(*a, **kw): pass
    def increment_incident(*a, **kw): pass
    def clear_session_metrics(*a, **kw): pass


# ── In-memory session store ──────────────────────────────────────────────────
active_sessions: dict[str, list] = {}
session_status:  dict[str, str]  = {}   # "observing" | "running" | "completed"
session_metadata: dict[str, dict] = {}  # derived rule info, thresholds, etc.

MERCHANT_ID = "merchant_demo"


# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="PayStream", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ───────────────────────────────────────────────────────────────────
class ObserveRequest(BaseModel):
    merchant_id: str = MERCHANT_ID

class ConfirmRuleRequest(BaseModel):
    session_id: str
    rule_text: str
    amount_per_interval: float = 5.0


# ── Session runner with incident tracking ────────────────────────────────────
async def run_session(session_id: str, merchant_id: str, amount_per_interval: float, scenario: str = "ev"):
    history: list = []
    consecutive_pauses = 0
    incident_active = False
    incident_start_time = None
    last_metric_key = "charge_rate"
    session_status[session_id] = "running"

    try:
        async for telemetry in simulate_service_session_async(session_id, scenario=scenario, interval=5.0, duration=120):
            event = evaluate_telemetry(
                session_id, merchant_id, telemetry, history, amount_per_interval
            )
            history.append(telemetry)
            active_sessions[session_id].append(event)
            last_metric_key = event.get("metric_key", "charge_rate")
            update_metrics(event, scenario, amount_per_interval)

            metric_val = event.get("metric_value", event.get("charge_rate", "?"))
            unit = event.get("unit", "kW")
            print(
                f"[{session_id}] {event['elapsed_seconds']:.0f}s | "
                f"{metric_val} {unit} | {event['action_taken']} Rs{event['amount_charged']}"
            )

            # ── Incident tracking ──────────────────────────────────────────
            if event["action_taken"] == "paused":
                consecutive_pauses += 1

                # Declare incident after 3 consecutive pauses
                if consecutive_pauses == 3 and not incident_active:
                    incident_active = True
                    incident_start_time = event["timestamp"]
                    print(f"[{session_id}] ⚠ INCIDENT DECLARED")
                    incident_event = declare_incident(
                        session_id, history, active_sessions[session_id]
                    )
                    active_sessions[session_id].append(incident_event)
                    increment_incident(session_id, scenario)

            else:
                if incident_active:
                    # Quality recovered — resolve the incident
                    incident_active = False
                    print(f"[{session_id}] ✓ INCIDENT RESOLVED")
                    resolved_event = resolve_incident(
                        session_id, history, incident_start_time or event["timestamp"]
                    )
                    active_sessions[session_id].append(resolved_event)
                consecutive_pauses = 0

    finally:
        session_status[session_id] = "completed"
        clear_session_metrics(session_id, scenario, last_metric_key)


# ── Observation runner (Feature 1) ───────────────────────────────────────────
async def run_observation(session_id: str):
    """
    Observes the first 3 telemetry readings WITHOUT charging.
    Then calls Haiku to derive a fair threshold from the baseline.
    """
    readings = []
    session_status[session_id] = "observing"

    async for telemetry in simulate_ev_session_async(session_id, interval=5.0, duration=120):
        readings.append(telemetry)
        # Push observation events so frontend can show live readings during spinner
        obs_event = {
            "type": "observation",
            "charge_rate": telemetry["charge_rate"],
            "elapsed_seconds": telemetry.get("elapsed_seconds", 0),
            "timestamp": telemetry["timestamp"],
        }
        active_sessions[session_id].append(obs_event)

        if len(readings) >= 3:
            break  # Only observe 3 readings (~15 seconds)

    # Derive rule from observed baseline
    derived = derive_rule_from_baseline(readings)
    session_metadata[session_id] = {
        "derived_rule": derived,
        "observation_readings": readings,
        "status": "awaiting_confirmation",
    }
    session_status[session_id] = "awaiting_confirmation"

    # Push derived rule event so frontend can show it
    active_sessions[session_id].append({
        "type": "rule_derived",
        **derived,
    })


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}


# ── Manual rule flow (existing) ───────────────────────────────────────────────

@app.post("/rules/translate")
async def translate_rule(req: RuleRequest):
    display_json = translate_for_display(req.rule_text)
    save_rule(req.merchant_id, req.rule_text)
    return {"status": "ok", "rule_text": req.rule_text, "compiled": display_json}


@app.post("/sessions/start")
async def start_session(req: SessionRequest):
    session_id = uuid.uuid4().hex[:8]
    active_sessions[session_id] = []
    asyncio.create_task(run_session(session_id, req.merchant_id, req.amount_per_interval, req.scenario))
    return {"session_id": session_id, "status": "started", "mode": "manual"}


# ── Agent-derives-rule flow (Feature 1) ──────────────────────────────────────

@app.post("/sessions/observe")
async def start_observation(req: ObserveRequest):
    """
    Feature 1: Start a 15-second observation phase.
    Agent watches 3 telemetry readings and derives a fair rule.
    """
    session_id = uuid.uuid4().hex[:8]
    active_sessions[session_id] = []
    asyncio.create_task(run_observation(session_id))
    return {"session_id": session_id, "status": "observing"}


@app.get("/sessions/{session_id}/derived-rule")
async def get_derived_rule(session_id: str):
    """Poll this until status is 'awaiting_confirmation'."""
    if session_id not in session_metadata:
        return {"status": session_status.get(session_id, "not_found")}
    meta = session_metadata[session_id]
    return {
        "status": meta["status"],
        "derived_rule": meta.get("derived_rule"),
    }


@app.post("/sessions/confirm")
async def confirm_session(req: ConfirmRuleRequest):
    """
    Feature 1: Merchant approves the derived rule (or adjusts it).
    Starts the real payment session.
    """
    session_id = req.session_id
    if session_id not in session_metadata:
        raise HTTPException(status_code=404, detail="Observation session not found")

    # Save the approved rule and start the real session
    save_rule(MERCHANT_ID, req.rule_text)
    asyncio.create_task(run_session(session_id, MERCHANT_ID, req.amount_per_interval))
    return {"session_id": session_id, "status": "started", "mode": "agent_derived"}


# ── Common session routes ─────────────────────────────────────────────────────

@app.get("/sessions/{session_id}/events")
async def get_events(session_id: str):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session_id,
        "status": session_status.get(session_id, "unknown"),
        "events": active_sessions[session_id],
    }


@app.get("/sessions/{session_id}/settlement")
async def get_settlement(session_id: str):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    events = active_sessions[session_id]
    payment_events = [e for e in events if "action_taken" in e]
    if not payment_events:
        raise HTTPException(status_code=400, detail="No payment events yet")
    return generate_settlement(session_id, events)


@app.get("/sessions/{session_id}/dispute")
async def get_dispute_package(session_id: str):
    """
    Feature 3: Generate a formal Service Quality Breach Notice.
    Agent proactively builds the evidence case for the merchant.
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    events = active_sessions[session_id]
    rule_text = get_rule_text(MERCHANT_ID)
    return generate_dispute_package(session_id, events, rule_text)


# ── Prometheus metrics ────────────────────────────────────────────────────────

@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus text format — only active when prometheus-client is installed."""
    if not METRICS_ENABLED:
        return Response("# Grafana metrics disabled. Install prometheus-client to enable.\n", media_type="text/plain")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    last_sent = 0
    try:
        while True:
            events = active_sessions.get(session_id, [])
            if len(events) > last_sent:
                for event in events[last_sent:]:
                    await websocket.send_json(event)
                last_sent = len(events)

            status = session_status.get(session_id, "unknown")
            if status == "completed" and last_sent >= len(events):
                await websocket.send_json({"type": "session_complete", "session_id": session_id})
                break
            elif status == "awaiting_confirmation" and last_sent >= len(events):
                # Nothing to push — frontend is polling derived-rule endpoint
                pass

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
