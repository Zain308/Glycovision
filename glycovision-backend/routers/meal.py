from fastapi import (
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

from services.vision import analyze_image
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
# LOG MEAL
# ---------------------------------------------------------

@router.post("/log-meal")
def log_meal(
    payload: MealLogRequest,
    user_id: str = Depends(get_current_user),
):

    db = get_db()


    db.table(
        "meals"
    ).insert({

        "user_id":
            user_id,

        "food_name":
            payload.food_name,

        "carbs":
            payload.carbs,

        "protein":
            payload.protein,

        "fat":
            payload.fat,

        "calories":
            payload.calories,

    }).execute()


    return {
        "status": "logged",
        "food_name": payload.food_name,
    }