from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.db import get_db
from core.user_time import get_profile_row
from models.schemas import ProfileUpdateRequest


router = APIRouter(
    prefix="/api/v1",
    tags=["Profile"],
)


# ---------------------------------------------------------
# GET PROFILE
# ---------------------------------------------------------

@router.get("/profile")
def get_profile(
    user_id: str = Depends(get_current_user),
):
    db = get_db()

    profile = get_profile_row(db, user_id)

    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="Profile not found",
        )

    return profile


# ---------------------------------------------------------
# UPDATE PROFILE
# ---------------------------------------------------------

@router.put("/profile")
def update_profile(
    payload: ProfileUpdateRequest,
    user_id: str = Depends(get_current_user),
):
    db = get_db()

    # Only include fields actually sent by the frontend, so a partial
    # update never overwrites ICR/ISF/etc. with None.
    update_data = payload.model_dump(
        exclude_unset=True,
        mode="json",
    )

    if not update_data:
        raise HTTPException(
            status_code=400,
            detail="No valid fields to update",
        )

    res = (
        db.table("profiles")
        .update(update_data)
        .eq("id", user_id)
        .execute()
    )

    if not res.data:
        raise HTTPException(
            status_code=404,
            detail="Profile not found",
        )

    return {
        "status": "updated",
        "updated_fields": list(
            update_data.keys()
        ),
    }
