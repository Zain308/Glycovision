from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from core.auth import get_current_user
from core.db import get_db
from core.user_time import (
    get_profile_row,
    user_timezone,
    local_day_start_utc_iso,
)
from models.schemas import BgLogRequest
from services.entries import save_once


router = APIRouter(
    prefix="/api/v1",
    tags=["Blood Glucose"],
)


# ---------------------------------------------------------
# LOG BLOOD GLUCOSE
# ---------------------------------------------------------

@router.post("/log-bg")
def log_bg(
    payload: BgLogRequest,
    user_id: str = Depends(get_current_user),
):
    save_once("bg_readings", user_id, {"value": payload.value}, payload)

    return {
        "status": "logged",
        "value": payload.value,
    }


# ---------------------------------------------------------
# TODAY'S READINGS
# ---------------------------------------------------------

@router.get("/bg-readings")
def get_bg_readings(
    user_id: str = Depends(get_current_user),
):
    db = get_db()

    # "Today" is the user's local day, not the UTC day.
    today_start = local_day_start_utc_iso(
        user_timezone(get_profile_row(db, user_id))
    )

    res = (
        db.table("bg_readings")
        .select("id, value, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", today_start)
        .order("logged_at", desc=True)
        .execute()
    )

    return res.data or []


# ---------------------------------------------------------
# BG HISTORY
# ---------------------------------------------------------

@router.get("/bg-history")
def get_bg_history(
    hours: int = Query(
        default=24,
        ge=1,
        le=720,
        description="Number of hours of BG history to return",
    ),
    user_id: str = Depends(get_current_user),
):
    """
    Returns BG readings for the requested history window.

    Default:
        24 hours

    Maximum:
        720 hours = 30 days

    The output is sorted oldest -> newest so it can be
    used directly by frontend chart components.
    """

    db = get_db()

    now = datetime.now(timezone.utc)

    start_time = (
        now
        - timedelta(hours=hours)
    ).isoformat()

    res = (
        db.table("bg_readings")
        .select("id, value, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", start_time)
        .order("logged_at", desc=False)
        .execute()
    )

    rows = res.data or []

    return {
        "window_hours": hours,
        "count": len(rows),
        "readings": [
            {
                "id": row.get("id"),
                "value": row["value"],
                "logged_at": row["logged_at"],
            }
            for row in rows
        ],
    }