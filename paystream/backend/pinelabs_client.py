import os
import httpx
from uuid import uuid4
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("PINE_LABS_BASE_URL", "https://pluraluat.v2.pinepg.in")
API_KEY = os.getenv("PINE_LABS_API_KEY", "")
MOCK = os.getenv("PINE_LABS_MOCK", "true").lower() == "true"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }


def charge_micro_payment(session_id: str, amount: float, reduce_by: float = 0) -> dict:
    """
    Charge `amount` INR for one interval, optionally reduced by a percentage.
    Returns mock response when PINE_LABS_MOCK=true.
    """
    actual = round(amount * (1 - reduce_by / 100), 2)

    if MOCK:
        return {
            "status": "success",
            "transaction_id": f"mock_{uuid4().hex[:8]}",
            "amount": actual,
            "currency": "INR",
            "mock": True,
        }

    # Real Pine Labs call — wire this once API spec is confirmed
    try:
        resp = httpx.post(
            f"{BASE_URL}/api/v2/payments/charge",
            json={
                "merchant_reference": session_id,
                "amount": int(actual * 100),  # in paise
                "currency": "INR",
                "description": f"PayStream interval charge — session {session_id}",
            },
            headers=_headers(),
            timeout=5.0,
        )
        return resp.json()
    except Exception as e:
        return {"status": "error", "message": str(e), "amount": actual}


def pause_payment(session_id: str) -> dict:
    """No-op pause — withholds payment for this interval."""
    return {
        "status": "paused",
        "session_id": session_id,
        "amount": 0.0,
        "currency": "INR",
    }
