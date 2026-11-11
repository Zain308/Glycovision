from fastapi import APIRouter, Depends
from core.auth import get_current_user
from core.db import get_db
from core.user_time import (
    get_profile_row,
    user_timezone,
    local_day_start_utc_iso,
)

router = APIRouter(prefix="/api/v1", tags=["Dashboard"])

@router.get("/dashboard-summary")
def dashboard_summary(user_id: str = Depends(get_current_user)):
    db = get_db()

    profile = get_profile_row(db, user_id) or {}

    # "Today" is the user's local day, not the UTC day.
    today_start = local_day_start_utc_iso(user_timezone(profile))

    meals_res = (
        db.table("meals").select("*")
        .eq("user_id", user_id)
        .gte("logged_at", today_start)
        .execute()
    )
    meals = meals_res.data or []

    bolus_res = (
        db.table("bolus_logs").select("*")
        .eq("user_id", user_id)
        .gte("logged_at", today_start)
        .execute()
    )
    bolus_logs = bolus_res.data or []

    bg_res = (
        db.table("bg_readings").select("*")
        .eq("user_id", user_id)
        .gte("logged_at", today_start)
        .order("logged_at", desc=True)
        .execute()
    )
    bg_readings = bg_res.data or []

    latest_bg = bg_readings[0]["value"] if bg_readings else None

    time_in_range_pct = None
    if bg_readings:
        in_range = sum(1 for r in bg_readings if 70 <= r["value"] <= 180)
        time_in_range_pct = round((in_range / len(bg_readings)) * 100)

    return {
        "full_name": profile.get("full_name") or "GlycoVision User",
        "diabetes_type": profile.get("diabetes_type") or "Type 1",
        "total_carbs_today": round(sum(m["carbs"] for m in meals), 1),
        "total_insulin_today": round(sum(b["dose_units"] for b in bolus_logs), 1),
        "meals_logged_today": len(meals),
        "latest_bg": latest_bg,
        "time_in_range_pct": time_in_range_pct,
        "bg_readings_today": len(bg_readings),
    }