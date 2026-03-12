# Autonomous Outcome-Linked Payment Agent — Hackathon Build Plan

---

## Project Overview

**Name:** PayStream — Autonomous Outcome-Linked Payments  
**Demo scenario:** EV Charging session where payments pause mid-session when charger underperforms  
**Core loop:** Merchant defines rule → Session starts → Telemetry streams → Agent evaluates → Micropayments fire or pause → Settlement with AI explanation

---

## System Architecture

```
[React Dashboard]
      ↕ (REST/WebSocket)
[FastAPI Backend]
      ↕
┌─────────────────────────────────────────────┐
│              Core Services                   │
│                                             │
│  [Rule Translator]    [Settlement Engine]   │
│   Bedrock/Haiku  →    Bedrock/Haiku         │
│        ↓                    ↑               │
│  [DynamoDB]          [DynamoDB]             │
│  rule_store          session_store          │
│        ↓                    ↑               │
│  [EV Simulator]  →  [Payment Agent]         │
│  (telemetry gen)    (rule evaluator)        │
│        ↓                    ↓               │
│  [Kinesis Stream]    [Pine Labs API]        │
└─────────────────────────────────────────────┘
```

---

## Directory Structure

```
paystream/
├── backend/
│   ├── main.py                  # FastAPI app, all routes
│   ├── rule_translator.py       # NL → JSON via Bedrock/Haiku
│   ├── payment_agent.py         # Core rule evaluation + Pine Labs calls
│   ├── settlement_engine.py     # End-of-session summary via Haiku
│   ├── ev_simulator.py          # Fake EV telemetry generator
│   ├── kinesis_consumer.py      # Polls Kinesis, triggers agent
│   ├── pinelabs_client.py       # Pine Labs API wrapper
│   ├── dynamo_client.py         # DynamoDB read/write helpers
│   └── models.py                # Pydantic models
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── RuleSetup.jsx        # Merchant rule input
│   │   │   ├── SessionDashboard.jsx # Live payment stream view
│   │   │   ├── TelemetryChart.jsx   # Real-time charge rate graph
│   │   │   ├── PaymentLog.jsx       # List of micro-charges/pauses
│   │   │   └── SettlementView.jsx   # Final summary screen
├── infra/
│   ├── setup_aws.py             # One-shot AWS resource creation script
│   └── seed_dynamo.py           # Seed test merchant/session data
├── .env
└── requirements.txt
```

---

## Phase 1: Backend Foundation (First 2 Hours)

### Step 1: Environment Setup (20 mins)

```bash
mkdir paystream && cd paystream
python -m venv venv && source venv/bin/activate
pip install fastapi uvicorn boto3 httpx python-dotenv pydantic websockets
```

**.env file:**
```
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
KINESIS_STREAM_NAME=paystream-telemetry
DYNAMO_TABLE_RULES=paystream-rules
DYNAMO_TABLE_SESSIONS=paystream-sessions
PINE_LABS_API_KEY=...
PINE_LABS_BASE_URL=https://sandbox.pinelabs.com  # confirm with organizers
BEDROCK_MODEL_ID=anthropic.claude-3-5-haiku-20241022-v1:0
```

---

### Step 2: AWS Infrastructure Setup (15 mins)

`infra/setup_aws.py` — run once at start of hackathon day:

```python
import boto3, os
from dotenv import load_dotenv
load_dotenv()

region = os.getenv("AWS_REGION")

def create_kinesis_stream():
    client = boto3.client("kinesis", region_name=region)
    client.create_stream(StreamName="paystream-telemetry", ShardCount=1)
    print("Kinesis stream created")

def create_dynamo_tables():
    client = boto3.client("dynamodb", region_name=region)
    
    # Rules table
    client.create_table(
        TableName="paystream-rules",
        KeySchema=[{"AttributeName": "merchant_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "merchant_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST"
    )
    
    # Sessions table
    client.create_table(
        TableName="paystream-sessions",
        KeySchema=[
            {"AttributeName": "session_id", "KeyType": "HASH"},
            {"AttributeName": "timestamp", "KeyType": "RANGE"}
        ],
        AttributeDefinitions=[
            {"AttributeName": "session_id", "AttributeType": "S"},
            {"AttributeName": "timestamp", "AttributeType": "S"}
        ],
        BillingMode="PAY_PER_REQUEST"
    )
    print("DynamoDB tables created")

if __name__ == "__main__":
    create_kinesis_stream()
    create_dynamo_tables()
```

---

### Step 3: Rule Translator — Haiku (30 mins)

`backend/rule_translator.py`

```python
import boto3, json, os

bedrock = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION"))

SYSTEM_PROMPT = """
You are a payment rule compiler. Convert merchant payment rules written in natural language 
into structured JSON. Output ONLY valid JSON, no explanation.

Output format:
{
  "condition_metric": "charge_rate" | "speed_mbps" | "temperature" | "voltage",
  "operator": "lt" | "gt" | "lte" | "gte",
  "threshold": <number>,
  "action": "pause" | "reduce",
  "reduce_by_percent": <number or null>,
  "resume_condition": "metric_recovers" | "manual"
}

Examples:
Input: "pause payment if charge rate drops below 20kW"
Output: {"condition_metric": "charge_rate", "operator": "lt", "threshold": 20, "action": "pause", "reduce_by_percent": null, "resume_condition": "metric_recovers"}

Input: "reduce payment by 50% if speed is below 5 Mbps"
Output: {"condition_metric": "speed_mbps", "operator": "lt", "threshold": 5, "action": "reduce", "reduce_by_percent": 50, "resume_condition": "metric_recovers"}
"""

def translate_rule_to_json(natural_language_rule: str) -> dict:
    response = bedrock.invoke_model(
        modelId=os.getenv("BEDROCK_MODEL_ID"),
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 300,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": natural_language_rule}]
        })
    )
    result = json.loads(response["body"].read())
    raw_text = result["content"][0]["text"].strip()
    return json.loads(raw_text)
```

---

### Step 4: Payment Agent — Core Logic (45 mins)

`backend/payment_agent.py`

```python
import json
from pinelabs_client import charge_micro_payment, pause_payment, resume_payment
from dynamo_client import log_session_event, get_rule_for_merchant

def evaluate_telemetry_event(session_id: str, merchant_id: str, telemetry: dict) -> dict:
    """
    Core agent function. Takes a telemetry snapshot, evaluates against rule,
    fires appropriate payment action.
    """
    rule = get_rule_for_merchant(merchant_id)
    metric_value = telemetry.get(rule["condition_metric"])
    threshold = rule["threshold"]
    operator = rule["operator"]

    condition_met = check_condition(metric_value, operator, threshold)

    if condition_met:
        # Quality degraded — pause or reduce payment
        if rule["action"] == "pause":
            result = pause_payment(session_id)
            action_taken = "paused"
        elif rule["action"] == "reduce":
            result = charge_micro_payment(session_id, reduce_by=rule["reduce_by_percent"])
            action_taken = "reduced"
    else:
        # Quality OK — fire normal micro-charge
        result = charge_micro_payment(session_id, reduce_by=0)
        action_taken = "charged"

    event = {
        "session_id": session_id,
        "timestamp": telemetry["timestamp"],
        "metric": rule["condition_metric"],
        "metric_value": metric_value,
        "threshold": threshold,
        "action_taken": action_taken,
        "payment_result": result
    }
    log_session_event(event)
    return event

def check_condition(value: float, operator: str, threshold: float) -> bool:
    ops = {
        "lt": value < threshold,
        "gt": value > threshold,
        "lte": value <= threshold,
        "gte": value >= threshold
    }
    return ops.get(operator, False)
```

---

### Step 5: EV Simulator (30 mins)

`backend/ev_simulator.py`

```python
import boto3, json, time, random, os
from datetime import datetime

kinesis = boto3.client("kinesis", region_name=os.getenv("AWS_REGION"))
STREAM_NAME = os.getenv("KINESIS_STREAM_NAME")

def simulate_ev_session(session_id: str, duration_seconds: int = 120):
    """
    Simulates an EV charging session.
    Normal: 22kW charge rate
    Degradation event at t=60s: drops to 15kW for 30s, then recovers
    """
    start_time = time.time()
    elapsed = 0
    
    while elapsed < duration_seconds:
        elapsed = time.time() - start_time
        
        # Inject degradation between 60s-90s
        if 60 <= elapsed <= 90:
            charge_rate = round(random.uniform(13.0, 17.0), 2)  # underperforming
        else:
            charge_rate = round(random.uniform(20.0, 24.0), 2)  # normal

        telemetry = {
            "session_id": session_id,
            "timestamp": datetime.utcnow().isoformat(),
            "charge_rate": charge_rate,  # kW
            "kwh_delivered": round(elapsed * charge_rate / 3600, 4),
            "voltage": round(random.uniform(228.0, 232.0), 1),
            "temperature": round(random.uniform(28.0, 35.0), 1)
        }
        
        kinesis.put_record(
            StreamName=STREAM_NAME,
            Data=json.dumps(telemetry),
            PartitionKey=session_id
        )
        
        print(f"[{elapsed:.0f}s] Charge rate: {charge_rate} kW")
        time.sleep(5)  # emit every 5 seconds (use 30 in prod)
```

---

### Step 6: Settlement Engine (30 mins)

`backend/settlement_engine.py`

```python
import boto3, json, os
from dynamo_client import get_session_events

bedrock = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION"))

def generate_settlement(session_id: str, total_billed: float, total_possible: float) -> dict:
    events = get_session_events(session_id)
    
    paused_events = [e for e in events if e["action_taken"] == "paused"]
    charged_events = [e for e in events if e["action_taken"] == "charged"]
    amount_withheld = total_possible - total_billed
    
    summary_for_llm = {
        "session_id": session_id,
        "total_intervals": len(events),
        "charged_intervals": len(charged_events),
        "paused_intervals": len(paused_events),
        "total_billed": total_billed,
        "total_possible": total_possible,
        "amount_withheld": amount_withheld,
        "degradation_events": [
            {"timestamp": e["timestamp"], "metric_value": e["metric_value"], "threshold": e["threshold"]}
            for e in paused_events
        ]
    }
    
    prompt = f"""
    Generate a clear, friendly settlement explanation for a merchant.
    Data: {json.dumps(summary_for_llm)}
    
    Format: 2-3 sentences max. State what was delivered, what fell short, and what was withheld.
    """
    
    response = bedrock.invoke_model(
        modelId=os.getenv("BEDROCK_MODEL_ID"),
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}]
        })
    )
    explanation = json.loads(response["body"].read())["content"][0]["text"]
    
    return {
        "session_id": session_id,
        "total_billed": total_billed,
        "total_possible": total_possible,
        "amount_withheld": amount_withheld,
        "explanation": explanation,
        "events": events
    }
```

---

### Step 7: FastAPI Backend (30 mins)

`backend/main.py`

```python
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio, uuid

from rule_translator import translate_rule_to_json
from ev_simulator import simulate_ev_session
from settlement_engine import generate_settlement
from dynamo_client import save_rule, get_session_events

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

active_sessions = {}  # session_id → live event log (in-memory for demo)

class RuleRequest(BaseModel):
    merchant_id: str
    rule_text: str

class SessionRequest(BaseModel):
    merchant_id: str
    amount_per_interval: float  # e.g. ₹5 per 30s

@app.post("/rules/translate")
async def create_rule(req: RuleRequest):
    rule_json = translate_rule_to_json(req.rule_text)
    save_rule(req.merchant_id, rule_json, req.rule_text)
    return {"status": "ok", "rule": rule_json}

@app.post("/sessions/start")
async def start_session(req: SessionRequest):
    session_id = str(uuid.uuid4())[:8]
    active_sessions[session_id] = []
    # Start simulator in background
    asyncio.create_task(run_session(session_id, req.merchant_id, req.amount_per_interval))
    return {"session_id": session_id}

@app.get("/sessions/{session_id}/events")
async def get_events(session_id: str):
    return active_sessions.get(session_id, [])

@app.get("/sessions/{session_id}/settlement")
async def get_settlement(session_id: str):
    events = active_sessions.get(session_id, [])
    charged = [e for e in events if e["action_taken"] == "charged"]
    total_possible = len(events) * 5.0
    total_billed = len(charged) * 5.0
    return generate_settlement(session_id, total_billed, total_possible)

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    last_sent = 0
    while True:
        events = active_sessions.get(session_id, [])
        if len(events) > last_sent:
            for event in events[last_sent:]:
                await websocket.send_json(event)
            last_sent = len(events)
        await asyncio.sleep(1)

async def run_session(session_id: str, merchant_id: str, amount_per_interval: float):
    from ev_simulator import simulate_ev_session_async
    from payment_agent import evaluate_telemetry_event
    async for telemetry in simulate_ev_session_async(session_id):
        event = evaluate_telemetry_event(session_id, merchant_id, telemetry)
        active_sessions[session_id].append(event)
```

---

## Phase 2: Frontend Dashboard (2 Hours)

### Component Plan

**RuleSetup.jsx** — Text input for merchant rule, shows compiled JSON on submit  
**SessionDashboard.jsx** — Main view with live charge rate graph + payment log  
**TelemetryChart.jsx** — Recharts line graph, charge rate vs threshold line  
**PaymentLog.jsx** — Scrolling log: green = charged, red = paused  
**SettlementView.jsx** — Final card with explanation text + amounts

### Key UI Logic

```jsx
// WebSocket connection for live updates
useEffect(() => {
  const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);
  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    setEvents(prev => [...prev, event]);
  };
  return () => ws.close();
}, [sessionId]);
```

**Visual cue that wins the demo:** When charge rate drops below threshold on the chart, the payment log entry flips from green to red in real-time. Judges will see the autonomous decision happen live.

---

## Phase 3: Pine Labs Integration (1 Hour)

`backend/pinelabs_client.py`

```python
import httpx, os

BASE_URL = os.getenv("PINE_LABS_BASE_URL")
API_KEY = os.getenv("PINE_LABS_API_KEY")

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def charge_micro_payment(session_id: str, amount: float = 5.0, reduce_by: int = 0):
    actual_amount = amount * (1 - reduce_by / 100)
    payload = {
        "merchant_reference": session_id,
        "amount": int(actual_amount * 100),  # in paise
        "currency": "INR",
        "description": f"PayStream micro-charge - session {session_id}"
    }
    response = httpx.post(f"{BASE_URL}/v2/payments/charge", json=payload, headers=HEADERS)
    return response.json()

def pause_payment(session_id: str):
    # If Pine Labs doesn't support holds, log a skip instead
    return {"status": "paused", "session_id": session_id, "amount": 0}
```

> **Note:** Adapt this once you have the actual Pine Labs API docs. The core pattern stays the same.

---

## Hackathon Day Timeline

| Time | Task |
|------|------|
| 0:00–0:30 | Run setup_aws.py, verify credentials, confirm Pine Labs sandbox |
| 0:30–1:30 | Build rule_translator + payment_agent + ev_simulator |
| 1:30–2:30 | Build FastAPI routes + WebSocket |
| 2:30–3:30 | Build React dashboard (focus on SessionDashboard + TelemetryChart) |
| 3:30–4:00 | Wire Pine Labs, end-to-end test |
| 4:00–4:30 | Settlement screen + Haiku explanation |
| 4:30–5:00 | Demo rehearsal, fix visual bugs |

---

## Demo Script (2 Minutes)

1. Open Rule Setup → type "pause payment if charge rate drops below 20kW" → show compiled JSON  
2. Start session → chart begins, green payments firing every 5s  
3. At ~60s — chart dips, red entries appear in payment log  
4. At ~90s — chart recovers, payments resume green  
5. Hit "Settle" → show final amount withheld + Haiku explanation  
6. **Closing line:** "The payment contract enforced itself. No dispute. No chargeback. No human needed."

---

## Claude Code Prompt

Copy this verbatim into a new Claude Code session:

---

```
You are helping me build "PayStream" — an autonomous outcome-linked payment agent for a one-day hackathon. 

The system streams micropayments in real-time during an EV charging session. Every 5 seconds, telemetry (charge rate in kW) is evaluated against a merchant-defined rule. If quality drops below threshold, payment is paused. At session end, an AI generates a settlement explanation.

Project structure:
paystream/
├── backend/       # FastAPI + Python
├── frontend/      # React + Vite + TailwindCSS
└── infra/         # AWS setup scripts

Tech stack:
- Backend: FastAPI, boto3, httpx, python-dotenv, pydantic
- Frontend: React, Vite, TailwindCSS, Recharts (for charts), WebSocket
- AWS: Kinesis (telemetry stream), DynamoDB (rules + session events), Bedrock (Claude Haiku)
- LLM: AWS Bedrock — model ID: anthropic.claude-3-5-haiku-20241022-v1:0
- Payments: Pine Labs Online sandbox API (treat as REST API, I'll fill in actual endpoints)

Core data models:
- Rule: { merchant_id, condition_metric, operator, threshold, action, reduce_by_percent, rule_text }
- TelemetryEvent: { session_id, timestamp, charge_rate, kwh_delivered, voltage }
- SessionEvent: { session_id, timestamp, metric_value, threshold, action_taken, amount_charged }
- Settlement: { session_id, total_billed, total_possible, amount_withheld, explanation, events }

Build the following in order:

1. infra/setup_aws.py — creates Kinesis stream "paystream-telemetry" and two DynamoDB tables: "paystream-rules" (PK: merchant_id) and "paystream-sessions" (PK: session_id, SK: timestamp). Load config from .env.

2. backend/dynamo_client.py — helper functions: save_rule(merchant_id, rule_json, rule_text), get_rule_for_merchant(merchant_id), log_session_event(event_dict), get_session_events(session_id).

3. backend/rule_translator.py — calls Bedrock Haiku with a system prompt to convert natural language merchant rules into a JSON rule object. Input: string. Output: dict. Handle JSON parse errors gracefully.

4. backend/ev_simulator.py — async generator simulate_ev_session_async(session_id) that yields telemetry dicts every 5 seconds. Normal charge rate: 20-24kW. Between t=60s and t=90s, inject degradation: 13-17kW. Also write a sync version simulate_ev_session() that pushes to Kinesis.

5. backend/pinelabs_client.py — wrapper with charge_micro_payment(session_id, amount, reduce_by_percent) and pause_payment(session_id). Use httpx. Load base URL and API key from .env. Return mock response if PINE_LABS_MOCK=true in env.

6. backend/payment_agent.py — evaluate_telemetry_event(session_id, merchant_id, telemetry) → fetches rule from DynamoDB, evaluates condition, calls appropriate Pine Labs function, logs event, returns event dict.

7. backend/settlement_engine.py — generate_settlement(session_id, events) → calls Bedrock Haiku to generate a 2-3 sentence plain English explanation of what was charged, what was paused, and why.

8. backend/main.py — FastAPI app with:
   - POST /rules/translate — accepts {merchant_id, rule_text}, returns compiled rule JSON
   - POST /sessions/start — accepts {merchant_id, amount_per_interval}, starts async EV simulation, returns session_id
   - GET /sessions/{session_id}/events — returns all events so far
   - GET /sessions/{session_id}/settlement — generates and returns settlement
   - WebSocket /ws/{session_id} — streams new events to frontend in real-time
   Use an in-memory dict to store live session events (no need for DynamoDB on hot path for demo).
   Include CORS middleware allowing all origins.

9. frontend/ — React app with Vite + TailwindCSS:
   - RuleSetup component: text input + submit button → POST to /rules/translate → show compiled JSON card
   - SessionDashboard: Start Session button → POST to /sessions/start → opens WebSocket → live updates
   - TelemetryChart: Recharts LineChart showing charge_rate over time. Add a red dashed horizontal reference line at threshold value.
   - PaymentLog: scrolling list of events. Green row = "charged", Red row = "paused", Yellow = "reduced". Show timestamp, metric value, action taken, amount.
   - SettlementView: button to GET /sessions/{id}/settlement → display total billed, total withheld, and AI explanation in a card.
   - Overall design: dark theme, clean, fintech aesthetic. Use Tailwind utility classes only.

10. .env.example and requirements.txt

Important constraints:
- All AWS calls should gracefully handle missing credentials (log warning, return mock data)
- Use PINE_LABS_MOCK=true env flag for demo mode — charge_micro_payment returns {"status": "success", "transaction_id": "mock_xxx", "amount": amount}
- The WebSocket must push events immediately as they arrive, not batch them
- Frontend must show the payment pausing visually in real-time — this is the key demo moment
- Keep all backend logic in flat files (no nested packages) for simplicity

Start by scaffolding the full directory structure with all files, then implement each file completely.
```
