import asyncio
import random
from datetime import datetime, timezone


SCENARIOS = {
    "ev": {
        "metric_key": "charge_rate",
        "unit": "kW",
        "normal_range": (20.0, 24.0),
        "degraded_range": (13.0, 17.0),
        "degraded_is_high": False,
    },
    "cloud": {
        "metric_key": "api_latency_ms",
        "unit": "ms",
        "normal_range": (150.0, 300.0),
        "degraded_range": (600.0, 950.0),
        "degraded_is_high": True,
    },
    "delivery": {
        "metric_key": "delivery_minutes",
        "unit": "min",
        "normal_range": (20.0, 35.0),
        "degraded_range": (50.0, 75.0),
        "degraded_is_high": True,
    },
    "solar": {
        "metric_key": "power_output_kw",
        "unit": "kW",
        "normal_range": (6.0, 9.0),
        "degraded_range": (2.0, 4.0),
        "degraded_is_high": False,
    },
    "freelance": {
        "metric_key": "completion_rate",
        "unit": "%",
        "normal_range": (85.0, 95.0),
        "degraded_range": (40.0, 65.0),
        "degraded_is_high": False,
    },
}


async def simulate_service_session_async(
    session_id: str,
    scenario: str = "ev",
    interval: float = 5.0,
    duration: int = 75,
):
    """
    Async generator — yields one telemetry dict every `interval` seconds.

    Timeline for every scenario (75s total for live demo pacing):
      0s – 25s  : Normal service   (within normal_range)   ~5 intervals
      25s – 55s : Degradation      (within degraded_range) ~6 intervals -> incident declared
      55s – end : Recovery         (back to normal_range)  ~4 intervals -> incident resolved
    """
    cfg = SCENARIOS.get(scenario, SCENARIOS["ev"])
    metric_key = cfg["metric_key"]
    start = asyncio.get_event_loop().time()

    while True:
        elapsed = asyncio.get_event_loop().time() - start
        if elapsed >= duration:
            break

        if 25 <= elapsed <= 55:
            metric_value = round(random.uniform(*cfg["degraded_range"]), 2)
        else:
            metric_value = round(random.uniform(*cfg["normal_range"]), 2)

        yield {
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_seconds": round(elapsed, 1),
            metric_key: metric_value,
            "scenario": scenario,
            "metric_key": metric_key,
            "unit": cfg["unit"],
        }

        await asyncio.sleep(interval)


# Backward compat alias — used by run_observation (EV-only)
async def simulate_ev_session_async(
    session_id: str,
    interval: float = 5.0,
    duration: int = 120,
):
    async for reading in simulate_service_session_async(session_id, "ev", interval, duration):
        yield reading
