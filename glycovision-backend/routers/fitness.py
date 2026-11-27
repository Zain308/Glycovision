from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from core.auth import get_current_user
from core.db import get_db
from core.user_time import get_profile_row, user_timezone
from models.schemas import VitalLogRequest
from services import fitness_store as store
from services.entries import already_saved, made_at
from services.fitness import local_day
from services.health_data import parse_time

router = APIRouter(prefix="/api/v1", tags=["Fitness"])
NOT_READY = "This can't be saved yet. The server needs its database update."


@router.get("/fitness")
def fitness(user_id: str = Depends(get_current_user)):
    try:
        return store.build_fitness(user_id)
    except Exception as error:
        print("[Fitness]", repr(error)[:300])
        raise HTTPException(status_code=500, detail="Could not load your activity. Please try again.")


@router.post("/vitals")
def add_vital(payload: VitalLogRequest, user_id: str = Depends(get_current_user)):
    try:
        if not already_saved("vitals", user_id, payload):
            store.save_vitals(user_id, [{
                "kind": payload.kind, "value": payload.value, "value2": payload.value2, "time": made_at(payload),
                "client_id": str(payload.client_id) if payload.client_id else None,
            }], "manual")
    except HTTPException:
        raise
    except Exception as error:
        print("[Vitals]", repr(error)[:300])
        raise HTTPException(status_code=503, detail=NOT_READY)
    return {"status": "saved"}


@router.delete("/vitals/{vital_id}")
def delete_vital(vital_id: int, user_id: str = Depends(get_current_user)):
    get_db().table("vitals").delete().eq("id", vital_id).eq("user_id", user_id).execute()
    return {"status": "deleted"}


@router.delete("/activity/{log_id}")
def delete_activity(log_id: int, background: BackgroundTasks, user_id: str = Depends(get_current_user)):
    db = get_db()
    rows = db.table("activity_logs").select("*").eq("id", log_id).eq("user_id", user_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Activity not found.")
    db.table("activity_logs").delete().eq("id", log_id).eq("user_id", user_id).execute()
    day = local_day(parse_time(rows[0]["logged_at"]), user_timezone(get_profile_row(db, user_id)))
    background.add_task(store.save_days, user_id, [day])
    return {"status": "deleted"}

