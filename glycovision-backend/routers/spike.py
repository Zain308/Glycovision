from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)

from core.auth import get_current_user

from services.spike_features import (
    build_patient_snapshot,
)

from services.training_samples import (
    generate_training_samples,
)

from models.schemas import (
    SpikeFeatureRequest,
)

from services.spike_predictor import (
    predict_spike,
    get_spike_model_info,
)

from services.app_spike_predictor import (
    predict_user_spike_risk,
    get_app_spike_model_info,
)

from services.spike_intervention import (
    build_spike_intervention,
)
from services.stress_context import get_stress_context


router = APIRouter(
    prefix="/api/v1",
    tags=["Spike Prediction"],
)


# =========================================================
# CURRENT PATIENT SNAPSHOT
# =========================================================

@router.get("/patient-snapshot")
def patient_snapshot(
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        snapshot = build_patient_snapshot(
            user_id
        )

        return {
            "status": "ready",
            "snapshot": snapshot,
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print(
            "[Patient Snapshot Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not generate "
                "patient snapshot."
            ),
        )


# =========================================================
# GENERATE PERSONAL TRAINING SAMPLES
# =========================================================

@router.post("/generate-training-samples")
def generate_samples(
    days: int = Query(
        default=30,
        ge=1,
        le=365,
    ),
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        result = generate_training_samples(
            user_id=user_id,
            lookback_days=days,
        )

        return {
            "status": "complete",
            **result,
        }

    except Exception as error:
        print(
            "[Training Sample Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not generate "
                "training samples."
            ),
        )


# =========================================================
# OLD / FULL 28-FEATURE MODEL INFO
# =========================================================

@router.get("/spike-model-info")
def spike_model_info(
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        return get_spike_model_info()

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    except Exception as error:
        print(
            "[Spike Model Info Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not load "
                "spike model information."
            ),
        )


# =========================================================
# OLD / MANUAL 28-FEATURE PREDICTION
# =========================================================

@router.post("/predict-spike")
def predict_spike_endpoint(
    payload: SpikeFeatureRequest,
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        return predict_spike(
            payload.model_dump()
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    except Exception as error:
        print(
            "[Predict Spike Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not generate "
                "manual spike prediction."
            ),
        )


# =========================================================
# NEW APP-COMPATIBLE 24-FEATURE MODEL INFO
# =========================================================

@router.get("/app-spike-model-info")
def app_spike_model_info(
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        return get_app_spike_model_info()

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    except Exception as error:
        print(
            "[App Spike Model Info Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not load "
                "app spike model information."
            ),
        )


# =========================================================
# NEW LIVE APP SPIKE-RISK PREDICTION
# =========================================================

@router.get("/spike-risk")
def get_spike_risk(
    user_id: str = Depends(
        get_current_user
    ),
):
    try:
        return predict_user_spike_risk(
            user_id
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    except Exception as error:
        print(
            "[Spike Risk Error]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not generate "
                "spike-risk prediction."
            ),
        )

@router.get(
    "/spike-intervention"
)
def spike_intervention(
    user_id: str = Depends(
        get_current_user
    ),
):

    guidance = build_spike_intervention(
        user_id
    )

    # Combine with stress from a recent voice check, so the next step
    # reflects both the glucose trend and how the user is doing.
    try:
        context = get_stress_context(user_id)
    except Exception as error:
        print("[Spike Intervention] Stress context unavailable:", repr(error))
        context = None

    if context and context.get("level") in ("possible", "elevated"):
        guidance["stress_context"] = context
        if guidance.get("severity") in ("moderate", "elevated"):
            guidance["stress_note"] = (
                "Your recent voice check also suggests stress, which can push "
                "blood sugar higher. Check again in 30 to 60 minutes."
            )
        else:
            guidance["stress_note"] = (
                "Your recent voice check suggests stress. Stress can raise blood "
                "sugar over the next few hours, so check a little more often today."
            )

    return guidance