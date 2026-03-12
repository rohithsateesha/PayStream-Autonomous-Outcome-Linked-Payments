import asyncio
import random
from datetime import datetime, timezone


async def simulate_ev_session_async(
    session_id: str,
    interval: float = 5.0,
    duration: int = 120,
):
    """
    Async generator — yields one telemetry dict every `interval` seconds.

    Timeline:
      0s – 60s  : Normal charging  (20–24 kW)
      60s – 90s : Degradation      (13–17 kW)  ← triggers payment pause
      90s – end : Recovery         (20–24 kW)
    """
    start = asyncio.get_event_loop().time()

    while True:
        elapsed = asyncio.get_event_loop().time() - start
        if elapsed >= duration:
            break

        if 60 <= elapsed <= 90:
            charge_rate = round(random.uniform(13.0, 17.0), 2)
        else:
            charge_rate = round(random.uniform(20.0, 24.0), 2)

        yield {
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_seconds": round(elapsed, 1),
            "charge_rate": charge_rate,
            "kwh_delivered": round(elapsed * charge_rate / 3600, 4),
            "voltage": round(random.uniform(228.0, 232.0), 1),
        }

        await asyncio.sleep(interval)
