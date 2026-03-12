import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import RuleRequest, SessionRequest
from rule_translator import translate_for_display
from dynamo_client import save_rule
from ev_simulator import simulate_ev_session_async
from payment_agent import evaluate_telemetry
from settlement_engine import generate_settlement


# ── In-memory session store (sufficient for demo) ──────────────────────────
active_sessions: dict[str, list] = {}
session_status: dict[str, str] = {}  # "running" | "completed"


# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="PayStream", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Background session runner ────────────────────────────────────────────────
async def run_session(session_id: str, merchant_id: str, amount_per_interval: float):
    history: list = []
    session_status[session_id] = "running"
    try:
        async for telemetry in simulate_ev_session_async(session_id, interval=5.0, duration=120):
            event = evaluate_telemetry(
                session_id, merchant_id, telemetry, history, amount_per_interval
            )
            history.append(telemetry)
            active_sessions[session_id].append(event)
            print(
                f"[{session_id}] {event['elapsed_seconds']:.0f}s | "
                f"{event['charge_rate']} kW | {event['action_taken']} ₹{event['amount_charged']}"
            )
    finally:
        session_status[session_id] = "completed"


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/rules/translate")
async def translate_rule(req: RuleRequest):
    """
    Translates a natural language rule to structured JSON (for display),
    then saves the original rule_text for use by the payment agent.
    """
    display_json = translate_for_display(req.rule_text)
    save_rule(req.merchant_id, req.rule_text)
    return {
        "status": "ok",
        "rule_text": req.rule_text,
        "compiled": display_json,
    }


@app.post("/sessions/start")
async def start_session(req: SessionRequest):
    session_id = uuid.uuid4().hex[:8]
    active_sessions[session_id] = []
    asyncio.create_task(run_session(session_id, req.merchant_id, req.amount_per_interval))
    return {"session_id": session_id, "status": "started"}


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
    if not events:
        raise HTTPException(status_code=400, detail="No events yet — session may still be starting")
    return generate_settlement(session_id, events)


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

            # Close gracefully when session is done and all events sent
            if (
                session_status.get(session_id) == "completed"
                and last_sent >= len(active_sessions.get(session_id, []))
            ):
                await websocket.send_json({"type": "session_complete", "session_id": session_id})
                break

            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
