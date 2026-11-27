from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from core.auth import get_current_user
from core.db import get_db
from models.schemas import DeleteAccountRequest, MedicineLogRequest, MedicineRequest
from services import care_store as store

router = APIRouter(prefix="/api/v1", tags=["Care"])
NOT_READY = "This can't be saved yet. The server needs its database update."
MAX_MEDICINES = 40


def _guard(what: str, error: Exception):
    print(f"[{what}]", repr(error)[:300])
    raise HTTPException(status_code=503, detail=NOT_READY)


# ------------------------------------------------------------- medicines

@router.get("/medicines")
def list_medicines(user_id: str = Depends(get_current_user)):
    try:
        return store.medicine_overview(user_id)
    except Exception as error:
        _guard("Medicines", error)


@router.post("/medicines")
def add_medicine(payload: MedicineRequest, user_id: str = Depends(get_current_user)):
    try:
        have = get_db().table("medicines").select("id").eq("user_id", user_id).eq("active", True).execute().data or []
        if len(have) >= MAX_MEDICINES:
            raise HTTPException(status_code=422, detail="You have reached the limit of 40 medicines.")
        get_db().table("medicines").insert({"user_id": user_id, **payload.model_dump()}).execute()
    except HTTPException:
        raise
    except Exception as error:
        _guard("Medicines", error)
    return {"status": "saved"}


@router.put("/medicines/{medicine_id}")
def change_medicine(medicine_id: int, payload: MedicineRequest, user_id: str = Depends(get_current_user)):
    if not store.own_medicine(user_id, medicine_id):
        raise HTTPException(status_code=404, detail="Medicine not found.")
    get_db().table("medicines").update(payload.model_dump()).eq("id", medicine_id).eq("user_id", user_id).execute()
    return {"status": "saved"}


@router.delete("/medicines/{medicine_id}")
def stop_medicine(medicine_id: int, user_id: str = Depends(get_current_user)):
    """Taken off the list; its history stays for the doctor's report."""
    if not store.own_medicine(user_id, medicine_id):
        raise HTTPException(status_code=404, detail="Medicine not found.")
    get_db().table("medicines").update({"active": False}).eq("id", medicine_id).eq("user_id", user_id).execute()
    return {"status": "removed"}


@router.post("/medicines/{medicine_id}/log")
def log_medicine(medicine_id: int, payload: MedicineLogRequest, user_id: str = Depends(get_current_user)):
    medicine = store.own_medicine(user_id, medicine_id)
    if not medicine:
        raise HTTPException(status_code=404, detail="Medicine not found.")
    if payload.time not in (medicine.get("times") or []):
        raise HTTPException(status_code=422, detail="This medicine has no dose at that time.")
    if not date.today() - timedelta(days=8) <= payload.day <= date.today() + timedelta(days=1):
        raise HTTPException(status_code=422, detail="Only the last week can be changed.")
    key = {"medicine_id": medicine_id, "day": payload.day.isoformat(), "time": payload.time}
    try:
        if payload.status is None:
            get_db().table("medicine_logs").delete().eq("user_id", user_id).eq("medicine_id", medicine_id) \
                .eq("day", key["day"]).eq("time", payload.time).execute()
        else:
            get_db().table("medicine_logs").upsert({**key, "user_id": user_id, "status": payload.status}, on_conflict="medicine_id,day,time").execute()
    except Exception as error:
        _guard("Medicines", error)
    return {"status": "saved"}


# ------------------------------------------------------------- report and own data

@router.get("/report")
def report(days: int = Query(default=14, ge=7, le=90), user_id: str = Depends(get_current_user)):
    try:
        return store.build_report(user_id, days)
    except Exception as error:
        print("[Report]", repr(error)[:300])
        raise HTTPException(status_code=500, detail="Could not make the report. Please try again.")


@router.get("/export")
def export(user_id: str = Depends(get_current_user)):
    try:
        return store.export_all(user_id)
    except Exception as error:
        print("[Export]", repr(error)[:300])
        raise HTTPException(status_code=500, detail="Could not prepare your data. Please try again.")


@router.post("/delete-account")
def delete_account(payload: DeleteAccountRequest, user_id: str = Depends(get_current_user)):
    """Deletes everything for the signed-in user. `confirm` must be DELETE."""
    try:
        store.delete_account(user_id)
    except Exception as error:
        print("[Delete account]", repr(error)[:300])
        raise HTTPException(status_code=500, detail="Not everything could be deleted. Please try again.")
    return {"status": "deleted"}
