from fastapi import APIRouter, Depends

from models.schemas import (
    PatientState,
    BolusResponse,
    BolusLogRequest,
)

from services.entries import save_once
from services.bolus_engine import calculate_safe_bolus
from services.stress_context import get_stress_context
from services.care_plan import test_calculator_dose
from services.iob_engine import (
    calculate_current_iob,
    effective_dia_hours,
)

from core.auth import get_current_user
from core.db import get_db
from core.user_time import get_profile_row


router = APIRouter(
    prefix="/api/v1",
    tags=["Bolus"],
)


# ---------------------------------------------------------
# CALCULATE INTERVENTION
# ---------------------------------------------------------

@router.post(
    "/calculate-intervention",
    response_model=BolusResponse,
)
def calculate_intervention(
    state: PatientState,
    user_id: str = Depends(get_current_user),
):
    result = calculate_safe_bolus(state)

    # Same insulin-curve test as the care plan, so both screens agree. It
    # can only lower the estimate (or withhold it for insulins that don't
    # fit the model).
    try:
        test_calculator_dose(user_id, state, result)
    except Exception as error:
        print("[Bolus] Dose test unavailable:", repr(error)[:200])

    # Attach stress context from a recent voice check. It adds advice
    # beside the estimate and never changes the dose. A failure here must
    # not block the calculation.
    try:
        context = get_stress_context(user_id)
        if context.get("status") == "recent":
            result.stress_context = context
    except Exception as error:
        print("[Bolus] Stress context unavailable:", repr(error))

    return result


# ---------------------------------------------------------
# CURRENT INSULIN ON BOARD
# ---------------------------------------------------------

@router.get("/current-iob")
def current_iob(
    user_id: str = Depends(get_current_user),
):
    db = get_db()

    profile = get_profile_row(db, user_id) or {}

    # Older profiles may hold a DIA below the curve's valid range;
    # clamp it so the IOB model never divides by zero.
    dia_hours = effective_dia_hours(profile.get("dia_hours"))

    iob = calculate_current_iob(
        user_id,
        dia_hours,
    )

    return {
        "iob": iob,
        "dia_hours": dia_hours,
    }


# ---------------------------------------------------------
# LOG BOLUS
# ---------------------------------------------------------

@router.post("/log-bolus")
def log_bolus(
    payload: BolusLogRequest,
    user_id: str = Depends(get_current_user),
):
    save_once("bolus_logs", user_id, {
        "dose_units": payload.dose_units,
        "carbs": payload.carbs,
        "current_bg": payload.current_bg,
    }, payload)

    return {
        "status": "logged",
        "dose_units": payload.dose_units,
    }
