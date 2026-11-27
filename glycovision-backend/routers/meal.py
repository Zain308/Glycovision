from fastapi import (
    Query,
    APIRouter,
    File,
    UploadFile,
    HTTPException,
    Depends,
)

import os
import shutil
import threading
import uuid

from services.entries import save_once
from services.vision import analyze_image, build_dish_result, NUTRITION_TABLE
from services.portions import portion_for
from services.food_classifier import get_food_classifier
from services.job_manager import (
    create_job,
    set_job_result,
    set_job_error,
    get_job_for_user,
)


from models.schemas import MealLogRequest
from core.auth import get_current_user
from core.db import get_db


router = APIRouter(
    prefix="/api/v1",
    tags=["Meal Analysis"],
)


# ---------------------------------------------------------
# BACKGROUND ANALYSIS
# ---------------------------------------------------------

def _run_analysis(
    job_id: str,
    temp_name: str,
):
    try:

        result = analyze_image(
            temp_name
        )

        set_job_result(
            job_id,
            result,
        )

    except Exception as error:

        print(
            "[Meal Analysis Error]",
            error,
        )

        set_job_error(
            job_id,
            str(error),
        )

    finally:

        try:

            if os.path.exists(
                temp_name
            ):

                os.remove(
                    temp_name
                )

        except PermissionError:

            print(
                "[meal router] "
                "Could not delete temporary image "
                f"because the file is still locked: {temp_name}"
            )


# ---------------------------------------------------------
# ANALYZE MEAL
# ---------------------------------------------------------

@router.post("/analyze-meal-async")
async def analyze_meal_async(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):

    # ---------------------------------------------
    # Validate file type
    # ---------------------------------------------

    content_type = (
        file.content_type
        or ""
    )

    if not content_type.startswith(
        "image/"
    ):

        raise HTTPException(
            status_code=400,
            detail="Uploaded file must be an image.",
        )


    # ---------------------------------------------
    # Create temporary directory
    # ---------------------------------------------

    os.makedirs(
        "tmp",
        exist_ok=True,
    )


    # Keep the original extension when possible
    original_name = (
        file.filename
        or ""
    )

    _, extension = os.path.splitext(
        original_name
    )


    if not extension:

        extension = ".jpg"


    temp_name = os.path.join(
        "tmp",
        f"meal_{uuid.uuid4().hex}{extension}",
    )


    # ---------------------------------------------
    # Save uploaded image
    # ---------------------------------------------

    try:

        with open(
            temp_name,
            "wb",
        ) as buffer:

            shutil.copyfileobj(
                file.file,
                buffer,
            )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=f"Could not save uploaded image: {error}",
        )


    # ---------------------------------------------
    # Create analysis job
    # ---------------------------------------------

    job_id = create_job(
        user_id
    ) 


    thread = threading.Thread(
        target=_run_analysis,
        args=(
            job_id,
            temp_name,
        ),
        daemon=True,
    )

    thread.start()


    return {
        "job_id": job_id,
        "status": "pending",
    }


# ---------------------------------------------------------
# ANALYSIS STATUS
# ---------------------------------------------------------

@router.get(
    "/analysis-status/{job_id}"
)
def analysis_status(
    job_id: str,
    user_id: str = Depends(
        get_current_user
    ),
):

    job = get_job_for_user(
        job_id,
        user_id,
    )

    if job is None:

        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return {
        "status":
            job["status"],

        "result":
            job["result"],

        "error":
            job["error"],

        "created_at":
            job["created_at"],
    }

# ---------------------------------------------------------
# DISH CHOSEN BY THE USER
# ---------------------------------------------------------

@router.get("/dish-nutrition/{food_name}")
def dish_nutrition(
    food_name: str,
    # The model's probability for this dish (0-1), shown as "x% sure".
    confidence: float | None = Query(default=None, ge=0, le=1),
    user_id: str = Depends(get_current_user),
):
    """
    Same result shape as a photo analysis, for a dish the user picked
    from the scanner's suggestions when the model was unsure.
    """

    if food_name not in get_food_classifier().class_names or food_name == "not_food":
        raise HTTPException(status_code=404, detail="Unknown dish")

    return build_dish_result({
        "food_name": food_name,
        "confidence": confidence if confidence is not None else 1.0,
        "source": "user_choice",
    })


# ---------------------------------------------------------
# FOOD LIBRARY
# ---------------------------------------------------------

@router.get("/foods")
def food_library(user_id: str = Depends(get_current_user)):
    """
    Every dish with published nutrition, per typical portion, for the
    app's food library (search without a photo).
    """

    foods = []
    for slug, entry in NUTRITION_TABLE.items():
        portion = portion_for(slug)
        per100 = entry["per_100g"]
        factor = portion["unit_grams"] / 100.0
        foods.append({
            "food_name": slug,
            "display_name": slug.replace("_", " ").title(),
            "portion": portion,
            "per_portion": {k: round(v * factor, 1) for k, v in per100.items()},
            "per_100g": per100,
            "match": entry["match"],
            "source": "; ".join(p["source"] + ": " + p["name"] for p in entry["parts"]),
        })
    foods.sort(key=lambda f: f["display_name"])
    return {"foods": foods}


# ---------------------------------------------------------
# LOG MEAL
# ---------------------------------------------------------

@router.post("/log-meal")
def log_meal(
    payload: MealLogRequest,
    user_id: str = Depends(get_current_user),
):

    save_once("meals", user_id, {
        "food_name": payload.food_name,
        "carbs": payload.carbs,
        "protein": payload.protein,
        "fat": payload.fat,
        "calories": payload.calories,
    }, payload)


    return {
        "status": "logged",
        "food_name": payload.food_name,
    }