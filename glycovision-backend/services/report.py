"""
Numbers for the doctor's report. Facts from the patient's own logs only:
no advice, no diagnosis, no dose.

Ranges follow the international consensus on time in range (Battelino et al.,
Diabetes Care 2019): below 54, 54-69, 70-180, 181-250, above 250 mg/dL.
"Time in range" needs a sensor; for finger-pricks it is the share of readings,
and the report says so. GMI (Bergenstal 2018) is given only with enough
sensor data, because finger-pricks are not spread evenly over the day.
"""

from collections import defaultdict
from datetime import date
from statistics import mean, pstdev

GMI_MIN_DAYS = 10
CGM_READINGS_A_DAY = 100        # more than any finger-pricking; a 15-min sensor has 96
PARTS = [("Night (12–6 AM)", 0, 6), ("Morning (6 AM–12 PM)", 6, 12), ("Afternoon (12–6 PM)", 12, 18), ("Evening (6 PM–12 AM)", 18, 24)]


def glucose_summary(readings: list[dict], tz) -> dict:
    """readings: [{'value', 'time'}] with aware times."""
    if not readings:
        return {"count": 0}
    values = [r["value"] for r in readings]
    n = len(values)
    share = lambda test: round(100 * sum(1 for v in values if test(v)) / n, 1)
    by_day: dict[date, list[float]] = defaultdict(list)
    by_part: dict[str, list[float]] = defaultdict(list)
    for r in readings:
        t = r["time"].astimezone(tz)
        by_day[t.date()].append(r["value"])
        for name, a, b in PARTS:
            if a <= t.hour < b:
                by_part[name].append(r["value"])
    avg = mean(values)
    sensor_days = sum(1 for v in by_day.values() if len(v) >= CGM_READINGS_A_DAY)
    return {
        "count": n, "days": len(by_day), "per_day": round(n / len(by_day), 1),
        "average": round(avg), "sd": round(pstdev(values)), "cv": round(100 * pstdev(values) / avg, 1) if n > 1 else None,
        "lowest": round(min(values)), "highest": round(max(values)),
        "very_low": share(lambda v: v < 54), "low": share(lambda v: 54 <= v < 70), "in_range": share(lambda v: 70 <= v <= 180),
        "high": share(lambda v: 180 < v <= 250), "very_high": share(lambda v: v > 250),
        "sensor": sensor_days >= GMI_MIN_DAYS,
        "gmi": round(3.31 + 0.02392 * avg, 1) if sensor_days >= GMI_MIN_DAYS else None,
        "daily": [{"day": d.isoformat(), "average": round(mean(v)), "min": round(min(v)), "max": round(max(v)), "count": len(v)} for d, v in sorted(by_day.items())],
        "by_part": [{"part": name, "average": round(mean(by_part[name])) if by_part[name] else None, "count": len(by_part[name]),
                     "low": sum(1 for v in by_part[name] if v < 70), "high": sum(1 for v in by_part[name] if v > 180)} for name, _, _ in PARTS],
        "low_events": low_events(readings, tz),
    }


def low_events(readings: list[dict], tz, limit: int = 12) -> list[dict]:
    """Readings under 70, one per 30 minutes, newest first."""
    out, last = [], None
    for r in sorted(readings, key=lambda r: r["time"]):
        if r["value"] >= 70:
            continue
        if last and (r["time"] - last["time"]).total_seconds() < 1800:
            if r["value"] < last["value"]:
                last["value"] = r["value"]
            last["time"] = r["time"]
            continue
        last = {"value": r["value"], "time": r["time"], "first": r["time"]}
        out.append(last)
    return [{"value": round(e["value"]), "at": e["first"].astimezone(tz).isoformat()} for e in out[::-1][:limit]]


def per_day(total: float, days: int) -> float | None:
    return round(total / days, 1) if days else None
