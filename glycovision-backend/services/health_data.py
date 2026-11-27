"""
Steps, heart rate and calories sent by the phone (Health Connect), and
activity typed in by hand. Every read tolerates the tables not existing
yet (sql/2026-11-23_health_flow.sql not run): it then returns nothing.
"""

from datetime import datetime, timedelta, timezone
from statistics import mean, median

from core.db import get_db
from services.fitness import sitting_now

BUCKET_MIN = 5
KINDS = ("steps", "heart_rate", "active_kcal")


def parse_time(value) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def bucket(dt: datetime) -> datetime:
    dt = dt.astimezone(timezone.utc)
    return dt.replace(minute=dt.minute - dt.minute % BUCKET_MIN, second=0, microsecond=0)


def merge_samples(samples: list[dict]) -> list[dict]:
    """One row per kind and 5-minute bucket: steps and calories add up, heart rate averages."""
    groups: dict[tuple, list[float]] = {}
    for s in samples:
        groups.setdefault((s["kind"], bucket(s["time"])), []).append(float(s["value"]))
    return [
        {
            "kind": kind,
            "bucket_start": start.isoformat(),
            "value": round(mean(v) if kind == "heart_rate" else sum(v), 2),
        }
        for (kind, start), v in sorted(groups.items())
    ]


def save_samples(user_id: str, samples: list[dict]) -> int:
    """Upsert, so sending the same period again replaces it instead of doubling it."""
    rows = [{"user_id": user_id, **r} for r in merge_samples(samples)]
    for i in range(0, len(rows), 500):
        get_db().table("health_samples").upsert(
            rows[i:i + 500], on_conflict="user_id,kind,bucket_start"
        ).execute()
    return len(rows)


def _rows(table: str, time_col: str, user_id: str, since: datetime, kind: str | None = None) -> list[dict]:
    try:
        query = get_db().table(table).select("*").eq("user_id", user_id).gte(time_col, since.isoformat())
        if kind:
            query = query.eq("kind", kind)
        # Newest first, so a row limit can only cut the oldest rows.
        data = query.order(time_col, desc=True).limit(1000).execute().data or []
    except Exception as error:
        print(f"[Health] {table} unavailable:", repr(error)[:200])
        return []
    out = []
    for r in data:
        try:
            out.append({**r, "_t": parse_time(r[time_col])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def manual_activity(user_id: str, since: datetime) -> list[dict]:
    return _rows("activity_logs", "logged_at", user_id, since)


def wearable_features(user_id: str, now: datetime) -> dict:
    """Same meaning as the training features; None when there is no data."""
    since = now - timedelta(minutes=60 + BUCKET_MIN)

    def recent(kind):
        return [r for r in _rows("health_samples", "bucket_start", user_id, since, kind) if r["_t"] <= now]

    def within(rows, minutes):
        start = now - timedelta(minutes=minutes + BUCKET_MIN)
        return [float(r["value"]) for r in rows if r["_t"] > start]

    hr, steps = recent("heart_rate"), recent("steps")
    out = {"hr_15m": None, "hr_60m": None, "steps_15m": None, "steps_60m": None}
    if within(hr, 15):
        out["hr_15m"], out["hr_60m"] = mean(within(hr, 15)), mean(within(hr, 60))
    # No step rows can mean "phone not syncing", so steps stay unknown, not zero.
    if steps:
        out["steps_15m"], out["steps_60m"] = sum(within(steps, 15)), sum(within(steps, 60))
    return out


def resting_heart_rate(user_id: str, now: datetime) -> float | None:
    """Typical heart rate in 5-minute buckets with almost no steps, last 3 days."""
    since = now - timedelta(days=3)
    hr = _rows("health_samples", "bucket_start", user_id, since, "heart_rate")
    walked = {
        r["_t"]
        for r in _rows("health_samples", "bucket_start", user_id, since, "steps")
        if float(r["value"]) > 20
    }
    still = [float(r["value"]) for r in hr if r["_t"] not in walked]
    return median(still) if len(still) >= 24 else None


def today_summary(user_id: str, day_start: datetime) -> dict:
    def rows(kind):
        return _rows("health_samples", "bucket_start", user_id, day_start, kind)

    steps, kcal, hr = rows("steps"), rows("active_kcal"), rows("heart_rate")
    logs = manual_activity(user_id, day_start)
    latest_hr = max(hr, key=lambda r: r["_t"]) if hr else None
    last = max((r["_t"] for r in steps + kcal + hr), default=None)
    return {
        "sitting_min": sitting_now(
            {r["_t"]: float(r["value"]) for r in steps}, day_start, datetime.now(timezone.utc),
            last + timedelta(minutes=BUCKET_MIN) if last else None),
        "connected": last is not None,
        "steps": round(sum(float(r["value"]) for r in steps)) if steps else None,
        "active_kcal": round(sum(float(r["value"]) for r in kcal)) if kcal else None,
        "heart_rate": round(float(latest_hr["value"])) if latest_hr else None,
        "manual_minutes": sum(int(r["minutes"]) for r in logs),
        "manual": [
            {"activity": r["activity"], "minutes": r["minutes"], "logged_at": r["logged_at"]} for r in logs
        ],
        "last_sync": last.isoformat() if last else None,
    }
