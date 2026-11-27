"""
Database work for medicines, imported blood sugar, the doctor's report, and
the user's right to download or delete everything.
"""

from bisect import bisect_left
from datetime import datetime, timedelta, timezone

from core.db import get_db
from core.user_time import get_profile_row, user_timezone
from services import fitness as fit
from services import report as rep
from services.body_metrics import body_metrics
from services.health_data import parse_time
from services.medicines import adherence, today_list

PAGE = 1000
# Every table with the user's rows, children first. medicine_logs must come
# before medicines.
USER_TABLES = (
    "medicine_logs", "medicines", "vitals", "health_sessions", "health_daily", "health_samples", "activity_logs",
    "stress_logs", "voice_baselines", "training_samples", "bolus_logs", "meals", "bg_readings",
)


def read_all(table: str, user_id: str, column: str | None = None, since: str | None = None, columns: str = "*", cap: int = 60000) -> list[dict]:
    """All rows, page by page (one reply holds 1,000)."""
    out: list[dict] = []
    while len(out) < cap:
        q = get_db().table(table).select(columns).eq("user_id", user_id)
        if column and since:
            q = q.gte(column, since)
        if column:
            q = q.order(column, desc=False)
        rows = q.range(len(out), len(out) + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            break
    return out


def safe(table: str, *args, **kw) -> list[dict]:
    try:
        return read_all(table, *args, **kw)
    except Exception as error:
        print(f"[Care] {table} unavailable:", repr(error)[:200])
        return []


# ------------------------------------------------------------- blood sugar from meters and sensors

SAME_MIN = 3               # minutes
SAME_VALUE = 3             # mg/dL


def new_readings(incoming: list[dict], existing: list[dict]) -> list[dict]:
    """
    Leaves out what is already saved: the same moment, or a reading the
    patient typed in from the same finger-prick.
    """
    saved = sorted((e["time"], e["value"]) for e in existing)
    out = [r for r in sorted(incoming, key=lambda r: r["time"]) if not _twin(saved, r)]
    # The same reading sent twice in one request.
    seen, unique = set(), []
    for r in out:
        if r["time"] not in seen:
            seen.add(r["time"])
            unique.append(r)
    return unique


def _twin(saved, r) -> bool:
    lo = bisect_left(saved, (r["time"] - timedelta(minutes=SAME_MIN), -1))
    for t, v in saved[lo:]:
        gap = (t - r["time"]).total_seconds()
        if gap > SAME_MIN * 60:
            return False
        if abs(gap) < 1 or abs(v - r["value"]) <= SAME_VALUE:
            return True
    return False


def import_readings(user_id: str, incoming: list[dict]) -> int:
    if not incoming:
        return 0
    incoming = [{**r, "time": r["time"].astimezone(timezone.utc)} for r in incoming]
    start = min(r["time"] for r in incoming) - timedelta(minutes=10)
    existing = []
    for e in read_all("bg_readings", user_id, "logged_at", start.isoformat(), "value,logged_at,source"):
        try:
            existing.append({"time": parse_time(e["logged_at"]), "value": float(e["value"]), "source": e.get("source")})
        except (KeyError, TypeError, ValueError):
            continue
    # A sensor reads every 5 minutes: two sensor readings close together are
    # different readings. Only typed-in ones can be twins.
    typed = [e for e in existing if e["source"] != "health_connect"]
    auto = {e["time"] for e in existing if e["source"] == "health_connect"}
    rows = [r for r in new_readings(incoming, typed) if r["time"] not in auto]
    for i in range(0, len(rows), 500):
        get_db().table("bg_readings").insert([
            {"user_id": user_id, "value": round(r["value"]), "logged_at": r["time"].isoformat(), "source": "health_connect"}
            for r in rows[i:i + 500]
        ]).execute()
    return len(rows)


# ------------------------------------------------------------- medicines

def medicine_overview(user_id: str) -> dict:
    db = get_db()
    tz = user_timezone(get_profile_row(db, user_id))
    now = datetime.now(timezone.utc).astimezone(tz)
    medicines = db.table("medicines").select("*").eq("user_id", user_id).eq("active", True).order("created_at", desc=False).execute().data or []
    since = (now.date() - timedelta(days=8)).isoformat()
    logs = db.table("medicine_logs").select("*").eq("user_id", user_id).gte("day", since).limit(1000).execute().data or []
    return {
        "medicines": [{k: m.get(k) for k in ("id", "name", "dose", "times", "note")} for m in medicines],
        "today": today_list(medicines, logs, now),
        "adherence": adherence(medicines, logs, now.date(), tz),
        "day": now.date().isoformat(),
    }


def own_medicine(user_id: str, medicine_id: int) -> dict | None:
    rows = get_db().table("medicines").select("*").eq("id", medicine_id).eq("user_id", user_id).limit(1).execute().data or []
    return rows[0] if rows else None


# ------------------------------------------------------------- report

def build_report(user_id: str, days: int) -> dict:
    db = get_db()
    profile = get_profile_row(db, user_id) or {}
    tz = user_timezone(profile)
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date()
    first = today - timedelta(days=days - 1)
    since = datetime.combine(first, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc).isoformat()

    def values(table, columns, key):
        out = []
        for r in safe(table, user_id, "logged_at", since, columns):
            try:
                out.append({"value": float(r[key]), "time": parse_time(r["logged_at"])})
            except (KeyError, TypeError, ValueError):
                continue
        return out

    readings = [r for r in values("bg_readings", "value,logged_at", "value") if 20 <= r["value"] <= 600]
    doses = values("bolus_logs", "dose_units,logged_at", "dose_units")
    meals = values("meals", "carbs,logged_at", "carbs")
    day_of = lambda r: r["time"].astimezone(tz).date()
    fitness = safe("health_daily", user_id, "day", first.isoformat())
    steps = [r["steps"] for r in fitness if r.get("steps") is not None]
    vitals: dict[str, list] = {}
    for v in safe("vitals", user_id, "logged_at", (now - timedelta(days=365)).isoformat()):
        vitals.setdefault(v["kind"], []).append(v)
    latest = {k: max(rows, key=lambda r: str(r["logged_at"])) for k, rows in vitals.items()}
    bp = latest.get("blood_pressure")
    try:
        meds = medicine_overview(user_id)
    except Exception as error:
        print("[Report] medicines unavailable:", repr(error)[:200])
        meds = {"medicines": [], "adherence": {"percent": None, "taken": 0, "planned": 0, "days": 7}}
    try:
        from services.stress_pattern import get_stress_pattern
        stress = get_stress_pattern(user_id)["pattern"]["summary"]
    except Exception:
        stress = None
    return {
        "period": {"days": days, "from": first.isoformat(), "to": today.isoformat()},
        "patient": {
            "name": profile.get("full_name"), "diabetes_type": profile.get("diabetes_type"), "sex": profile.get("sex"),
            "age": body_metrics(profile)["age"], "height_cm": profile.get("height_cm"), "weight_kg": profile.get("weight_kg"),
            "bmi": body_metrics(profile)["bmi"], "icr": profile.get("icr"), "isf": profile.get("isf"),
            "target_bg": profile.get("target_bg"), "insulin_type": profile.get("insulin_type"), "mealtime_insulin": profile.get("mealtime_insulin"),
        },
        "glucose": rep.glucose_summary(readings, tz),
        "insulin": {"doses": len(doses), "per_day": rep.per_day(sum(d["value"] for d in doses), len({day_of(d) for d in doses})), "days": len({day_of(d) for d in doses})},
        "meals": {"count": len(meals), "carbs_per_day": rep.per_day(sum(m["value"] for m in meals), len({day_of(m) for m in meals})), "days": len({day_of(m) for m in meals})},
        "activity": {"days": len(steps), "steps_per_day": round(sum(steps) / len(steps)) if steps else None,
                     "heart_pts": sum(r.get("heart_pts") or 0 for r in fitness)},
        "vitals": {
            "hba1c": _vital(latest.get("hba1c")), "weight": _vital(latest.get("weight")),
            "blood_pressure": {**_vital(bp), "level": fit.blood_pressure_level(float(bp["value"]), float(bp["value2"]))[0]} if bp and bp.get("value2") else None,
        },
        "medicines": meds["medicines"], "adherence": meds["adherence"], "stress": stress,
        "made_at": now.isoformat(),
    }


def _vital(row) -> dict | None:
    return {"value": row["value"], "value2": row.get("value2"), "at": row["logged_at"]} if row else None


# ------------------------------------------------------------- the user's own data

def export_all(user_id: str) -> dict:
    """Everything stored about this user. Raises if any table can't be read,
    so a download is never silently incomplete."""
    out = {"exported_at": datetime.now(timezone.utc).isoformat(), "profile": get_profile_row(get_db(), user_id)}
    order = {"medicine_logs": "day", "medicines": "created_at", "health_sessions": "start_time", "health_daily": "day", "health_samples": "bucket_start",
             "training_samples": "created_at", "voice_baselines": None}
    for table in reversed(USER_TABLES):
        out[table] = read_all(table, user_id, order.get(table, "logged_at"), None, cap=200000)
    return out


def delete_account(user_id: str) -> None:
    """Every row, then the login itself. Stops at the first error, so the
    login is only removed when the data is really gone."""
    db = get_db()
    for table in USER_TABLES:
        db.table(table).delete().eq("user_id", user_id).execute()
    db.table("profiles").delete().eq("id", user_id).execute()
    db.auth.admin.delete_user(user_id)
