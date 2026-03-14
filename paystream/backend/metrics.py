"""
Prometheus metrics for PayStream.
Gauges and Counters updated per payment interval, exposed via /metrics.
Grafana Agent scrapes /metrics every 5s and remote_writes to Grafana Cloud.
"""
from prometheus_client import Gauge, Counter

# Current telemetry value (e.g. 22.5 kW, 340 ms, 42 min)
metric_value_gauge = Gauge(
    "paystream_metric_value",
    "Current service metric reading",
    ["session_id", "scenario", "metric_key"],
)

# Payment decision: 1=charged, 0.5=reduced, 0=paused
action_state_gauge = Gauge(
    "paystream_action_state",
    "Current payment action state (1=charged, 0.5=reduced, 0=paused)",
    ["session_id", "scenario"],
)

# Cumulative money charged this session (INR)
amount_charged_counter = Counter(
    "paystream_amount_charged_inr_total",
    "Cumulative INR charged",
    ["session_id", "scenario"],
)

# Cumulative money withheld this session (INR)
amount_withheld_counter = Counter(
    "paystream_amount_withheld_inr_total",
    "Cumulative INR withheld due to quality failures",
    ["session_id", "scenario"],
)

# Total incident declarations
incidents_counter = Counter(
    "paystream_incidents_total",
    "Number of service incidents declared",
    ["session_id", "scenario"],
)


def update_metrics(event: dict, scenario: str, amount_per_interval: float = 5.0):
    """Call after each payment event in run_session()."""
    sid    = event["session_id"]
    mkey   = event.get("metric_key", "charge_rate")
    mval   = event.get("metric_value", event.get("charge_rate", 0))
    action = event.get("action_taken", "charged")
    amount = event.get("amount_charged", 0.0)

    metric_value_gauge.labels(session_id=sid, scenario=scenario, metric_key=mkey).set(mval)

    state = 1.0 if action == "charged" else (0.5 if action == "reduced" else 0.0)
    action_state_gauge.labels(session_id=sid, scenario=scenario).set(state)

    amount_charged_counter.labels(session_id=sid, scenario=scenario).inc(amount)
    if action == "paused":
        withheld = round(amount_per_interval - amount, 2)
        if withheld > 0:
            amount_withheld_counter.labels(session_id=sid, scenario=scenario).inc(withheld)


def increment_incident(session_id: str, scenario: str):
    """Call when an incident is declared."""
    incidents_counter.labels(session_id=session_id, scenario=scenario).inc()


def clear_session_metrics(session_id: str, scenario: str, metric_key: str):
    """Remove gauge label sets when session ends so the graph stops at the last point."""
    for fn, labels in [
        (metric_value_gauge.remove, (session_id, scenario, metric_key)),
        (action_state_gauge.remove, (session_id, scenario)),
    ]:
        try:
            fn(*labels)
        except KeyError:
            pass
