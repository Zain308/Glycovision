from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from core.auth import get_current_user
from core.db import get_db
from core.user_time import get_profile_row, local_day_start_utc_iso, user_timezone
from models.schemas import MAX_MEAL_CARBS_G, ActivityLogRequest, HealthSyncRequest
from services import care_store, fitness_store, health_data
from services.body_metrics import body_metrics
from services.care_plan import build_care_plan
from services.entries import made_at, save_once
from services.fitness import local_day
from services.stress_fusion import stress_gauge

router = APIRouter(prefix="/api/v1", tags=["Health"])

MAX_AGE = timedelta(days=7)
HEART_RATE_RANGE = (25, 250)


def _usable(sample, now: datetime) -> bool:
    t = sample.time if sample.time.tzinfo else sample.time.replace(tzinfo=timezone.utc)
    if not (now - MAX_AGE <= t <= now + timedelta(minutes=10)):
        return False
    return sample.kind != "heart_rate" or HEART_RATE_RANGE[0] <= sample.value <= HEART_RATE_RANGE[1]


@router.post("/health-sync")
def health_sync(payload: HealthSyncRequest, background: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Steps, heart rate, calories, distance, sleep, workouts and vitals from the phone."""
    now = datetime.now(timezone.utc)
    samples = [
        {"kind": s.kind, "time": health_data.parse_time(s.time.isoformat()), "value": s.value}
        for s in payload.samples if _usable(s, now)
    ]
    utc = lambda t: health_data.parse_time(t.isoformat())
    sessions = [
        {**s.model_dump(), "start": utc(s.start), "end": utc(s.end)} for s in payload.sessions
        if timedelta(0) < utc(s.end) - utc(s.start) <= timedelta(hours=24)
        and now - timedelta(days=35) <= utc(s.start) and utc(s.end) <= now + timedelta(minutes=10)
    ]
    vitals = [
        {**v.model_dump(), "time": utc(v.time)} for v in payload.vitals
        if now - timedelta(days=365) <= utc(v.time) <= now + timedelta(minutes=10)
    ]
    try:
        saved = health_data.save_samples(user_id, samples) if samples else 0
    except Exception as error:
        print("[Health sync]", repr(error)[:300])
        raise HTTPException(status_code=503, detail="Health data can't be saved yet. The server needs its database update.")

    # Extras must not lose the steps and heart rate already saved.
    tz = user_timezone(get_profile_row(get_db(), user_id))
    today = local_day(now, tz)
    extras = 0
    glucose = [
        {"value": g.value, "time": utc(g.time)} for g in payload.glucose
        if now - MAX_AGE <= utc(g.time) <= now + timedelta(minutes=5)
    ]
    new_glucose = 0
    if glucose:
        try:
            new_glucose = care_store.import_readings(user_id, glucose)
        except Exception as error:
            print("[Health sync] glucose", repr(error)[:300])
    for name, work in (
        ("sessions", lambda: fitness_store.save_sessions(user_id, sessions)),
        ("vitals", lambda: fitness_store.save_vitals(user_id, vitals, "health_connect")),
        ("days", lambda: fitness_store.save_day_totals(
            user_id, [d.model_dump() for d in payload.days if today - timedelta(days=35) <= d.day], today - timedelta(days=2))),
    ):
        try:
            extras += work()
        except Exception as error:
            print(f"[Health sync] {name}", repr(error)[:300])
    touched = {local_day(s["time"], tz) for s in samples}
    touched |= {local_day(s[k], tz) for s in sessions if s["kind"] == "exercise" for k in ("start", "end")}
    if touched:
        background.add_task(fitness_store.save_days, user_id, touched)
    return {"status": "saved", "buckets": saved, "extras": extras, "glucose": new_glucose, "ignored": len(payload.samples) - len(samples)}


@router.post("/log-activity")
def log_activity(payload: ActivityLogRequest, background: BackgroundTasks, user_id: str = Depends(get_current_user)):
    try:
        save_once("activity_logs", user_id, payload.model_dump(exclude_none=True, exclude={"client_id", "age_seconds"}), payload)
    except HTTPException:
        raise
    except Exception as error:
        print("[Log activity]", repr(error)[:300])
        raise HTTPException(status_code=503, detail="Activity can't be saved yet. The server needs its database update.")
    background.add_task(fitness_store.save_days, user_id, [local_day(made_at(payload), user_timezone(get_profile_row(get_db(), user_id)))])
    return {"status": "logged", "activity": payload.activity, "minutes": payload.minutes}


@router.get("/activity-today")
def activity_today(user_id: str = Depends(get_current_user)):
    profile = get_profile_row(get_db(), user_id)
    start = health_data.parse_time(local_day_start_utc_iso(user_timezone(profile)))
    return health_data.today_summary(user_id, start)


@router.get("/body-metrics")
def get_body_metrics(user_id: str = Depends(get_current_user)):
    return body_metrics(get_profile_row(get_db(), user_id))


@router.get("/stress-gauge")
def get_stress_gauge(user_id: str = Depends(get_current_user)):
    return stress_gauge(user_id)


@router.get("/care-plan")
def care_plan(
    carbs: float | None = Query(default=None, ge=0, le=MAX_MEAL_CARBS_G),
    user_id: str = Depends(get_current_user),
):
    """Forecast, then insulin (if prescribed), then activity. `carbs`: a meal about to be eaten."""
    try:
        return build_care_plan(user_id, carbs)
    except Exception as error:
        print("[Care plan]", repr(error)[:300])
        raise HTTPException(status_code=500, detail="Could not build your plan. Please try again.")
