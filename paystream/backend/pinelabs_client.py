"""
Pine Labs Online Payment API client.

Integration strategy:
- Per-interval charges (every 5s) are tracked internally — no per-call Pine Labs API hit.
  A traditional payment gateway cannot charge a card 15 times in 75 seconds.
- At settlement time, ONE Pine Labs order is created for the verified total_billed amount.
  This is the real Pine Labs transaction that proves the outcome-linked payment.

Set PINE_LABS_MOCK=false and provide CLIENT_ID + CLIENT_SECRET to use real UAT API.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

load_dotenv()

BASE_URL      = os.getenv("PINE_LABS_BASE_URL", "https://pluraluat.v2.pinepg.in")
CLIENT_ID     = os.getenv("PINE_LABS_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("PINE_LABS_CLIENT_SECRET", "")
MOCK          = os.getenv("PINE_LABS_MOCK", "true").lower() == "true"

# ── Startup diagnostics ───────────────────────────────────────────────────────
print(f"[pinelabs] MOCK={MOCK}")
print(f"[pinelabs] CLIENT_ID={'SET (' + CLIENT_ID[:8] + '...)' if CLIENT_ID else 'NOT SET'}")
print(f"[pinelabs] CLIENT_SECRET={'SET' if CLIENT_SECRET else 'NOT SET'}")
print(f"[pinelabs] BASE_URL={BASE_URL}")


class PineLabsClient:
    """Thin wrapper around Pine Labs Online API with token caching."""

    def __init__(self):
        self._token: str | None = None
        self._token_expiry: datetime | None = None

    # ── Authentication ──────────────────────────────────────────────────────

    def _get_token(self) -> str:
        """Return cached token or refresh if expired."""
        now = datetime.now(timezone.utc)
        if self._token and self._token_expiry and now < self._token_expiry:
            return self._token

        resp = httpx.post(
            f"{BASE_URL}/api/auth/v1/token",
            json={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type": "client_credentials",
            },
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        # Cache for 55 minutes (tokens typically expire in 60 min)
        self._token_expiry = now + timedelta(minutes=55)
        print(f"[pinelabs] Token refreshed — expires {self._token_expiry.isoformat()}")
        return self._token

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json",
            "Request-ID": str(uuid.uuid4()),
            "Request-Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        }

    # ── Order APIs ──────────────────────────────────────────────────────────

    def create_order(self, session_id: str, amount_inr: float) -> dict:
        """
        Create a Pine Labs order for `amount_inr` INR.
        Called once at settlement with the autonomously-verified billed amount.
        """
        if MOCK:
            return self._mock_order(session_id, amount_inr)

        body = {
            "merchant_order_reference": f"PS_{session_id}",
            "order_amount": {
                "value": int(round(amount_inr * 100)),  # convert to paise
                "currency": "INR",
            },
            "pre_auth": False,
            "callback_url": "http://localhost:5173",
            "failure_callback_url": "http://localhost:5173",
            "purchase_details": {
                "customer": {
                    "email_id": "demo@paystream.ai",
                    "first_name": "PayStream",
                    "last_name": "Demo",
                    "mobile_number": "9999999999",
                },
                "merchant_metadata": {
                    "key1": "PayStream Outcome-Verified Settlement",
                    "key2": session_id,
                },
            },
        }

        try:
            resp = httpx.post(
                f"{BASE_URL}/api/pay/v1/orders",
                json=body,
                headers=self._headers(),
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json().get("data", resp.json())
            order_id    = data.get("order_id")
            order_token = data.get("order_token")
            print(f"[pinelabs] Order created: {order_id} status={data.get('status')} for Rs{amount_inr}")

            # Auto-complete with test UPI in UAT
            if order_id and order_token:
                self._complete_payment_uat(order_id, order_token, int(round(amount_inr * 100)))

            return data
        except httpx.HTTPStatusError as e:
            print(f"[pinelabs] create_order HTTP error {e.response.status_code}: {e.response.text}")
            raise
        except Exception as e:
            print(f"[pinelabs] create_order failed: {e}")
            raise

    def _complete_payment_uat(self, order_id: str, order_token: str, amount_paise: int):
        """
        Initiate UPI Collect payment on the created order.
        Endpoint: POST /api/pay/v1/orders/{order_id}/payments
        Uses test VPA success@ybl for UAT auto-approval.
        """
        body = {
            "payments": [
                {
                    "merchant_payment_reference": str(uuid.uuid4()),
                    "payment_amount": {"value": amount_paise, "currency": "INR"},
                    "payment_method": "UPI",
                    "payment_option": {
                        "upi_details": {
                            "txn_mode": "COLLECT",
                            "payer": {"vpa": "success@ybl"},
                        }
                    },
                }
            ]
        }
        try:
            resp = httpx.post(
                f"{BASE_URL}/api/pay/v1/orders/{order_id}/payments",
                json=body,
                headers=self._headers(),
                timeout=10.0,
            )
            print(f"[pinelabs] Payment RAW response ({resp.status_code}): {resp.text}")
            result = resp.json().get("data", resp.json())
            payments = result.get("payments", [{}])
            pay_status = payments[0].get("status") if payments else result.get("status")
            print(f"[pinelabs] Payment initiated: order_status={result.get('status')} payment_status={pay_status}")
        except httpx.HTTPStatusError as e:
            print(f"[pinelabs] Payment initiation HTTP {e.response.status_code}: {e.response.text}")
        except Exception as e:
            print(f"[pinelabs] Payment initiation failed: {e}")

    def get_order(self, order_id: str) -> dict:
        """Get order status from Pine Labs."""
        if MOCK:
            return {"order_id": order_id, "status": "CREATED", "mock": True}

        try:
            resp = httpx.get(
                f"{BASE_URL}/api/pay/v1/orders/{order_id}",
                headers=self._headers(),
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"[pinelabs] get_order failed: {e}")
            raise

    def _mock_order(self, session_id: str, amount_inr: float) -> dict:
        order_id = f"ord_{uuid.uuid4().hex[:12]}"
        print(f"[pinelabs] MOCK order {order_id} for Rs{amount_inr}")
        return {
            "order_id": order_id,
            "merchant_order_reference": f"PS_{session_id}",
            "status": "CREATED",
            "order_amount": {"value": int(amount_inr * 100), "currency": "INR"},
            "mock": True,
        }


# ── Module-level client singleton ─────────────────────────────────────────────
_client = PineLabsClient()


# ── Public functions (called by payment_agent and settlement_engine) ──────────

def charge_micro_payment(session_id: str, amount: float, reduce_by: float = 0) -> dict:
    """
    Track one interval payment. No Pine Labs API call here — the real order
    is created at settlement with the total verified amount.
    """
    actual = round(amount * (1 - reduce_by / 100), 2)
    return {
        "status": "tracked",
        "session_id": session_id,
        "interval_amount": actual,
        "currency": "INR",
        "note": "Tracked internally — Pine Labs order created at settlement",
    }


def pause_payment(session_id: str) -> dict:
    """Withhold payment for this interval. No Pine Labs call needed."""
    return {
        "status": "paused",
        "session_id": session_id,
        "amount": 0.0,
        "currency": "INR",
    }


def create_settlement_order(session_id: str, amount_billed: float) -> dict:
    """
    Create a real Pine Labs order for the verified session total.
    Called once when the merchant settles the session.
    """
    return _client.create_order(session_id, amount_billed)


def get_order_status(order_id: str) -> dict:
    """Fetch order status from Pine Labs."""
    return _client.get_order(order_id)
