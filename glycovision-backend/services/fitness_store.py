"""
Reads and saves everything the Fitness screen needs (services/fitness.py has
the rules). Every read tolerates tables that don't exist yet
(sql/2026-11-23_fitness.sql not run): it then returns nothing.
"""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone

from core.db import get_db
from core.user_time import get_profile_row, user_timezone
from services import fitness as fit
from services.body_metrics import age_from
from services.health_data import parse_time

KINDS = ("steps", "heart_rate", "active_kcal", "distance_m", "move_min", "heart_pts")
HISTORY_DAYS = 30
DAILY_FIELDS = ("steps", "distance_m", "active_kcal", "move_min", "heart_pts", "active_hours", "longest_sit_min",
                "hr_min", "hr_max", "hr_resting")


def _read(table: str, user_id: str, column: str, since: str, until: str | None = None, eq: dict | None = None, limit=1000) -> list[dict]:
    try:
        q = get_db().table(table).select("*").eq("user_id", user_id).gte(column, since)
        if until is not None:
            q = q.lt(column, until)
        for k, v in (eq or {}).items():
            q = q.eq(k, v)
        return q.order(column, desc=True).limit(limit).execute().data or []
    except Exception as error:
        print(f"[Fitness] {table} unavailable:", repr(error)[:200])
        return []


def day_bounds(day: date, tz) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0), tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def day_samples(user_id: str, start: datetime, end: datetime) -> dict:
    # One query per kind: a day has up to 288 rows of each, and a reply holds 1000.
    def one(kind):
        rows = _read("health_samples", user_id, "bucket_start", start.isoformat(), end.isoformat(), {"kind": kind})
        out = {}
        for r in rows:
            try:
                out[parse_time(r["bucket_start"])] = float(r["value"])
            except (KeyError, TypeError, ValueError):
                continue
        return kind, out

    with ThreadPoolExecutor(len(KINDS)) as pool:
        return {k: v for k, v in pool.map(one, KINDS) if v}


def _log_session(r: dict) -> dict | None:
    try:
        end = parse_time(r["logged_at"])
        return {"id": r.get("id"), "activity": r["activity"], "end": end, "start": end - timedelta(minutes=int(r["minutes"])),
                "minutes": int(r["minutes"]), "steps": r.get("steps"), "distance_m": _num(r.get("distance_m")),
                "kcal": _num(r.get("kcal")), "source": "you"}
    except (KeyError, TypeError, ValueError):
        return None


def _watch_session(r: dict) -> dict | None:
    try:
        start, end = parse_time(r["start_time"]), parse_time(r["end_time"])
        return {"activity": r.get("title") or "Workout", "start": start, "end": end, "source": "watch",
                "minutes": round((end - start).total_seconds() / 60), "steps": None, "distance_m": None, "kcal": None,
                **{k: r.get(k) for k in ("deep_min", "rem_min", "awake_min")}}
    except (KeyError, TypeError, ValueError):
        return None


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def sessions_between(user_id: str, start: datetime, end: datetime) -> list[dict]:
    # Started up to 10 hours earlier, so a session crossing midnight is found.
    early = (start - timedelta(hours=10)).isoformat()
    logs = [_log_session(r) for r in _read("activity_logs", user_id, "logged_at", start.isoformat())]
    watch = [_watch_session(r) for r in _read("health_sessions", user_id, "start_time", early, None, {"kind": "exercise"})]
    return [s for s in logs + watch if s and s["end"] > start and s["start"] < end]


def compute_day(user_id: str, day: date, profile: dict, tz, now: datetime) -> dict:
    start, end = day_bounds(day, tz)
    return fit.day_metrics(
        day_samples(user_id, start, end), sessions_between(user_id, start, end), start, end, now=now,
        age=age_from(profile.get("birth_year")), weight_kg=profile.get("weight_kg"), height_cm=profile.get("height_cm"))


def save_days(user_id: str, days, now: datetime | None = None) -> None:
    """Recompute and store whole days (after new data arrives)."""
    now = now or datetime.now(timezone.utc)
    profile = get_profile_row(get_db(), user_id) or {}
    tz = user_timezone(profile)
    today = fit.local_day(now, tz)
    rows = []
    for day in sorted(set(days))[-8:]:
        if day > today:
            continue
        m = compute_day(user_id, day, profile, tz, now)
        if m["steps"] is None and not m["move_min"] and m["hr_max"] is None:
            continue
        rows.append({"user_id": user_id, "day": day.isoformat(), "updated_at": now.isoformat(),
                     **{k: m[k] for k in DAILY_FIELDS}})
    if rows:
        try:
            get_db().table("health_daily").upsert(rows, on_conflict="user_id,day").execute()
        except Exception as error:
            print("[Fitness] Day totals not saved:", repr(error)[:200])


def save_day_totals(user_id: str, totals: list[dict], keep_from: date) -> int:
    """Older days that only have phone totals (first connection): never over
    days computed from 5-minute data."""
    known = {r["day"] for r in _read("health_daily", user_id, "day", (keep_from - timedelta(days=HISTORY_DAYS + 5)).isoformat())
             if r.get("heart_pts") is not None}
    rows = [{"user_id": user_id, "day": t["day"].isoformat(),
             **{k: round(t[k]) for k in ("steps", "distance_m", "active_kcal") if t.get(k) is not None}}
            for t in totals if t["day"] < keep_from and t["day"].isoformat() not in known]
    # A batch must have the same columns in every row.
    rows = [{"steps": None, "distance_m": None, "active_kcal": None, **r} for r in rows]
    if rows:
        get_db().table("health_daily").upsert(rows, on_conflict="user_id,day").execute()
    return len(rows)


def save_sessions(user_id: str, sessions: list[dict]) -> int:
    rows = {(s["kind"], s["start"]): {
        "user_id": user_id, "kind": s["kind"], "start_time": s["start"].isoformat(), "end_time": s["end"].isoformat(),
        "title": s.get("title"), "deep_min": s.get("deep_min"), "rem_min": s.get("rem_min"), "awake_min": s.get("awake_min"),
    } for s in sessions}
    if rows:
        get_db().table("health_sessions").upsert(list(rows.values()), on_conflict="user_id,kind,start_time").execute()
    return len(rows)


def save_vitals(user_id: str, vitals: list[dict], source: str) -> int:
    rows = {(v["kind"], v["time"]): {
        "user_id": user_id, "kind": v["kind"], "value": v["value"], "value2": v.get("value2"), "source": source,
        "logged_at": v["time"].isoformat(),
        **({"client_id": v["client_id"]} if v.get("client_id") else {}),
    } for v in vitals}
    if rows:
        get_db().table("vitals").upsert(list(rows.values()), on_conflict="user_id,kind,logged_at").execute()
    latest = max((v for v in vitals if v["kind"] == "weight"), key=lambda v: v["time"], default=None)
    # Keep the profile's weight (BMI, calories) up to date with the newest one.
    if latest:
        newer = [r for r in _read("vitals", user_id, "logged_at", latest["time"].isoformat(), None, {"kind": "weight"})
                 if parse_time(r["logged_at"]) > latest["time"]]
        if not newer:
            try:
                get_db().table("profiles").update({"weight_kg": round(latest["value"], 1)}).eq("id", user_id).execute()
            except Exception as error:
                print("[Fitness] Profile weight not updated:", repr(error)[:200])
    return len(rows)


def build_fitness(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    profile = get_profile_row(get_db(), user_id) or {}
    tz = user_timezone(profile)
    today = fit.local_day(now, tz)
    start, end = day_bounds(today, tz)
    first = today - timedelta(days=HISTORY_DAYS - 1)
    month_start = day_bounds(first, tz)[0]
    week_start = day_bounds(today - timedelta(days=6), tz)[0]

    with ThreadPoolExecutor(6) as pool:
        samples_f = pool.submit(day_samples, user_id, start, end)
        daily_f = pool.submit(_read, "health_daily", user_id, "day", first.isoformat())
        sessions_f = pool.submit(sessions_between, user_id, week_start, end)
        sleep_f = pool.submit(_read, "health_sessions", user_id, "start_time", (now - timedelta(days=8)).isoformat(), None, {"kind": "sleep"})
        vitals_f = pool.submit(_read, "vitals", user_id, "logged_at", (now - timedelta(days=365)).isoformat(), None, None, 300)
        bg_f = pool.submit(_read, "bg_readings", user_id, "logged_at", month_start.isoformat())
    samples, sessions = samples_f.result(), sessions_f.result()

    age = age_from(profile.get("birth_year"))
    todays = [s for s in sessions if s["end"] > start]
    metrics = fit.day_metrics(samples, todays, start, end, now=now, age=age,
                              weight_kg=profile.get("weight_kg"), height_cm=profile.get("height_cm"))
    last_sync = max((t for rows in samples.values() for t in rows), default=None)
    last_sync = last_sync + fit.BUCKET if last_sync else None
    sitting = fit.sitting_now(samples.get("steps", {}), start, now, last_sync)
    local = now.astimezone(tz)
    hour = local.hour + local.minute / 60

    step_goal = int(profile.get("step_goal") or fit.STEP_GOAL)
    heart_goal = int(profile.get("heart_goal") or fit.HEART_GOAL)

    by_day = {}
    for r in daily_f.result():
        try:
            by_day[date.fromisoformat(str(r["day"])[:10])] = {k: r.get(k) for k in DAILY_FIELDS}
        except (KeyError, ValueError):
            continue
    # Days with only a workout typed in (no phone data) still count.
    logged = defaultdict(list)
    for s in sessions:
        logged[fit.local_day(s["end"], tz)].append(s)
    for day, items in logged.items():
        if day not in by_day and day != today:
            a, b = day_bounds(day, tz)
            by_day[day] = {k: v for k, v in fit.day_metrics({}, items, a, b, age=age, weight_kg=profile.get("weight_kg")).items() if k in DAILY_FIELDS}
    by_day[today] = {k: metrics[k] for k in DAILY_FIELDS}
    days = [{"day": first + timedelta(days=i), **by_day.get(first + timedelta(days=i), {k: None for k in DAILY_FIELDS})}
            for i in range(HISTORY_DAYS)]

    readings = defaultdict(list)
    for r in bg_f.result():
        try:
            readings[fit.local_day(parse_time(r["logged_at"]), tz)].append(float(r["value"]))
        except (KeyError, TypeError, ValueError):
            continue

    vitals = _vitals(vitals_f.result())
    sleeps = [s for s in (_watch_session(r) for r in sleep_f.result()) if s]
    return {
        "today": {**metrics, "sitting_min": sitting, "last_sync": last_sync.isoformat() if last_sync else None},
        "goals": {"steps": step_goal, "heart_pts": heart_goal},
        "status": fit.day_status(metrics, hour, step_goal, sitting),
        "week": fit.week_status(days, heart_goal, today),
        "streak": fit.streak(days, step_goal, today),
        "days": [{**d, "day": d["day"].isoformat()} for d in days],
        "sugar_effect": fit.sugar_effect(days[:-1], readings, step_goal),
        "sleep": fit.sleep_summary(sleeps, vitals["typed_sleep"], now),
        "journal": [{
            "id": s.get("id"), "activity": s["activity"], "minutes": s["minutes"], "steps": s["steps"],
            "distance_m": s["distance_m"], "kcal": round(s["kcal"]) if s["kcal"] else None, "source": s["source"],
            "ended_at": s["end"].isoformat(),
        } for s in sorted(sessions, key=lambda s: s["end"], reverse=True)[:20]],
        "vitals": vitals["latest"],
        "weight_history": vitals["weight_history"],
    }


def _vitals(rows: list[dict]) -> dict:
    latest, weights, sleep = {}, [], []
    for r in rows:                    # newest first
        try:
            kind, value, when = r["kind"], float(r["value"]), parse_time(r["logged_at"])
        except (KeyError, TypeError, ValueError):
            continue
        item = {"id": r.get("id"), "value": value, "value2": _num(r.get("value2")), "logged_at": when.isoformat(), "source": r.get("source")}
        if kind == "blood_pressure" and item["value2"]:
            item["level"], item["text"] = fit.blood_pressure_level(value, item["value2"])
        latest.setdefault(kind, item)
        if kind == "weight":
            weights.append({"value": value, "logged_at": when.isoformat()})
        if kind == "sleep":
            sleep.append({"value": value, "time": when})
    return {"latest": latest, "weight_history": weights[:30][::-1], "typed_sleep": sleep}
