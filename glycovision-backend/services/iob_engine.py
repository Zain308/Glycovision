import math
from datetime import datetime, timedelta, timezone
from core.db import get_db


# The exponential curve below requires DIA > 2 x peak time (150 min for a
# 75-min peak); at exactly 150 min it divides by zero and below that the
# curve is invalid. Rapid-acting insulin DIA is clinically 3-8 hours.
MIN_DIA_HOURS = 3.0
MAX_DIA_HOURS = 8.0
DEFAULT_DIA_HOURS = 4.0


def effective_dia_hours(value) -> float:
    """Clamp a stored DIA to the range the IOB model supports."""
    try:
        dia = float(value)
    except (TypeError, ValueError):
        return DEFAULT_DIA_HOURS
    if not math.isfinite(dia) or dia <= 0:
        return DEFAULT_DIA_HOURS
    return min(MAX_DIA_HOURS, max(MIN_DIA_HOURS, dia))


def iob_fraction_remaining(minutes_ago: float, dia_minutes: float, peak_minutes: float = 75.0) -> float:
    """Fraction of a single bolus dose still active `minutes_ago` minutes after
    administration, using the exponential insulin-activity model (the curve used
    by OpenAPS/Loop, derived from the Walsh insulin action model).

    Returns 1.0 immediately after dosing, decaying smoothly to 0.0 at dia_minutes.
    peak_minutes is the time-to-peak activity (75 min is a common rapid-acting default).
    """
    if minutes_ago <= 0:
        return 1.0
    if minutes_ago >= dia_minutes:
        return 0.0

    tau = peak_minutes * (1 - peak_minutes / dia_minutes) / (1 - 2 * peak_minutes / dia_minutes)
    a = 2 * tau / dia_minutes
    s = 1 / (1 - a + (1 + a) * math.exp(-dia_minutes / tau))

    t = minutes_ago
    fraction_active = 1 - s * (1 - a) * (
        ((t ** 2) / (tau * dia_minutes * (1 - a)) - t / tau - 1) * math.exp(-t / tau) + 1
    )
    return max(0.0, min(1.0, fraction_active))


def calculate_current_iob(user_id: str, dia_hours: float) -> float:
    """Sums remaining IOB across every bolus dose logged within the last
    dia_hours, weighted by how much of each dose is still active right now."""
    db = get_db()
    dia_minutes = effective_dia_hours(dia_hours) * 60
    now = datetime.now(timezone.utc)
    lookback_iso = (now - timedelta(minutes=dia_minutes)).isoformat()

    res = (
        db.table("bolus_logs").select("dose_units, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", lookback_iso)
        .execute()
    )
    doses = res.data or []

    total_iob = 0.0
    for d in doses:
        logged_at = datetime.fromisoformat(d["logged_at"].replace("Z", "+00:00"))
        minutes_ago = (now - logged_at).total_seconds() / 60
        fraction = iob_fraction_remaining(minutes_ago, dia_minutes)
        total_iob += d["dose_units"] * fraction

    return round(total_iob, 2)