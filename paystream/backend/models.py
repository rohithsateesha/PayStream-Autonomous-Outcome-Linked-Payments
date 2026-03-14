from pydantic import BaseModel
from typing import Optional


class RuleRequest(BaseModel):
    merchant_id: str
    rule_text: str


class SessionRequest(BaseModel):
    merchant_id: str
    amount_per_interval: float = 5.0  # INR per 5-second interval
    scenario: str = "ev"              # ev | cloud | delivery | solar | freelance


class SessionEvent(BaseModel):
    session_id: str
    timestamp: str
    charge_rate: float
    kwh_delivered: float
    action_taken: str          # "charged" | "paused" | "reduced"
    amount_charged: float
    reason: str                # Haiku's live reasoning — shown in UI
    payment_result: dict


class Settlement(BaseModel):
    session_id: str
    total_billed: float
    total_possible: float
    amount_withheld: float
    charged_intervals: int
    paused_intervals: int
    explanation: str
