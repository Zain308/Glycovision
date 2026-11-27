from fastapi import APIRouter, Depends, HTTPException
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

@router.get("/timeline-today")
def timeline_today(user_id: str = Depends(get_current_user)):
    """
    Today's meals, insulin doses and blood sugar readings in time order,
    newest first, for the home screen timeline.
    """
    db = get_db()
    profile = get_profile_row(db, user_id) or {}
    today_start = local_day_start_utc_iso(user_timezone(profile))

    def rows(table: str, columns: str):
        res = (
            db.table(table).select(columns)
            .eq("user_id", user_id)
            .gte("logged_at", today_start)
            .order("logged_at", desc=True)
            .limit(30)
            .execute()
        )
        return res.data or []

    events = []
    for m in rows("meals", "id, food_name, carbs, calories, logged_at"):
        events.append({
            "id": m.get("id"),
            "type": "meal",
            "title": m.get("food_name") or "Meal",
            "detail": f"{round(m.get('carbs') or 0)} g carbs · {round(m.get('calories') or 0)} kcal",
            "logged_at": m["logged_at"],
        })
    for b in rows("bolus_logs", "id, dose_units, carbs, logged_at"):
        events.append({
            "id": b.get("id"),
            "type": "insulin",
            "title": f"{b.get('dose_units')} u insulin",
            "detail": f"For {round(b.get('carbs') or 0)} g carbs" if b.get("carbs") else "Research estimate saved",
            "logged_at": b["logged_at"],
        })
    for r in rows("bg_readings", "id, value, logged_at"):
        events.append({
            "id": r.get("id"),
            "type": "bg",
            "title": f"{round(r.get('value') or 0)} mg/dL",
            "detail": "Blood sugar reading",
            "value": r.get("value"),
            "logged_at": r["logged_at"],
        })

    events.sort(key=lambda e: e["logged_at"], reverse=True)
    return {"events": events[:30]}


ENTRY_TABLES = {"bg": "bg_readings", "meal": "meals", "insulin": "bolus_logs"}


@router.delete("/entries/{kind}/{entry_id}")
def delete_entry(kind: str, entry_id: int, user_id: str = Depends(get_current_user)):
    """A reading, meal or insulin dose logged by mistake or twice."""
    table = ENTRY_TABLES.get(kind)
    if not table:
        raise HTTPException(status_code=404, detail="Unknown entry.")
    db = get_db()
    found = db.table(table).select("id").eq("id", entry_id).eq("user_id", user_id).limit(1).execute().data
    if not found:
        raise HTTPException(status_code=404, detail="This entry was already deleted.")
    db.table(table).delete().eq("id", entry_id).eq("user_id", user_id).execute()
    return {"status": "deleted"}
