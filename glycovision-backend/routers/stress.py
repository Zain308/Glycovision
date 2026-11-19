import os
import shutil
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
)

from core.auth import get_current_user

from services.stress_engine import (
    analyze_voice,
    get_voice_history,
    log_stress_reading,
)

from services.voice_baseline import (
    build_voice_baseline,
    get_saved_baseline,
)

from services.voice_deviation import (
    compare_to_personal_baseline,
)

from services.stress_context import get_stress_context
from services.stress_pattern import get_stress_pattern


router = APIRouter(
    prefix="/api/v1",
    tags=["Stress"],
)


# =========================================================
# VOICE ANALYSIS
# =========================================================

@router.post("/stress-analyze")
async def stress_analyze(
    file: UploadFile = File(...),
    user_id: str = Depends(
        get_current_user
    ),
):

    temp_name = (
        f"temp_voice_{uuid.uuid4().hex}.m4a"
    )

    try:

        # -------------------------------------------------
        # 1. SAVE UPLOADED RECORDING TEMPORARILY
        # -------------------------------------------------

        print(
            "[Voice] Received recording:",
            file.filename,
        )

        with open(
            temp_name,
            "wb",
        ) as buffer:

            shutil.copyfileobj(
                file.file,
                buffer,
            )

        print(
            "[Voice] Temporary file created:",
            temp_name,
        )


        # -------------------------------------------------
        # 2. RUN PHASE-3 VOICE ANALYSIS
        # -------------------------------------------------

        result = analyze_voice(
            temp_name
        )

        print(
            "[Voice] Analysis result:",
            result,
        )


        # -------------------------------------------------
        # 3. SAVE RECORDING RESULT TO SUPABASE
        # -------------------------------------------------

        print(
            "[Voice DB] About to save result"
        )

        print(
            "[Voice DB] User:",
            user_id,
        )

        print(
            "[Voice DB] Model:",
            result.get(
                "model_status"
            ),
        )

        print(
            "[Voice DB] Quality:",
            result.get(
                "quality"
            ),
        )

        print(
            "[Voice DB] Acoustic score:",
            result.get(
                "acoustic_score"
            ),
        )


        log_stress_reading(
            user_id,
            result,
        )


        print(
            "[Voice DB] Save completed successfully"
        )


        # -------------------------------------------------
        # 4. COMPARE AGAINST PREVIOUS PERSONAL BASELINE
        # -------------------------------------------------
        #
        # IMPORTANT:
        # The saved baseline has NOT been refreshed yet.
        #
        # This means the current recording is compared
        # against the user's previous acoustic pattern.
        #
        # We do this BEFORE rebuilding the baseline so the
        # new recording does not influence its own comparison.
        # -------------------------------------------------

        comparison = compare_to_personal_baseline(
            user_id=user_id,
            voice_result=result,
        )

        print(
            "[Voice Comparison]",
            {
                "status":
                    comparison.get(
                        "status"
                    ),

                "pattern":
                    comparison.get(
                        "pattern"
                    ),

                "comparison_ready":
                    comparison.get(
                        "comparison_ready"
                    ),
            },
        )


        # -------------------------------------------------
        # 5. REFRESH PERSONAL BASELINE
        # -------------------------------------------------
        #
        # Only after the comparison has been calculated
        # do we rebuild the baseline.
        #
        # This refreshed baseline can then be used for
        # the NEXT recording.
        # -------------------------------------------------

        baseline_refresh = build_voice_baseline(
            user_id=user_id,
        )

        print(
            "[Voice Baseline Refresh]",
            {
                "status":
                    baseline_refresh.get(
                        "status"
                    ),

                "sample_count":
                    baseline_refresh.get(
                        "sample_count"
                    ),
            },
        )


        # -------------------------------------------------
        # 6. RETURN COMPLETE RESPONSE
        # -------------------------------------------------

        # What this recording means for the user, using the comparison
        # just calculated (before the baseline was refreshed).
        try:
            stress_context = get_stress_context(
                user_id,
                comparison=comparison,
            )
        except Exception as error:
            print("[Voice] Stress context unavailable:", repr(error))
            stress_context = None

        response = {
            **result,

            "stress_context":
                stress_context,

            "personal_comparison":
                comparison,

            "baseline_refresh": {
                "status":
                    baseline_refresh.get(
                        "status"
                    ),

                "sample_count":
                    baseline_refresh.get(
                        "sample_count"
                    ),

                "required_samples":
                    baseline_refresh.get(
                        "required_samples"
                    ),

                "remaining_samples":
                    baseline_refresh.get(
                        "remaining_samples"
                    ),
            },
        }


        print(
            "[Voice] Returning response:",
            response,
        )

        return response


    # -----------------------------------------------------
    # USER / RECORDING ERRORS
    # -----------------------------------------------------

    except ValueError as error:

        print(
            "[Voice] Recording rejected:",
            str(error),
        )

        raise HTTPException(
            status_code=400,
            detail=str(error),
        )


    # -----------------------------------------------------
    # FASTAPI ERRORS
    # -----------------------------------------------------

    except HTTPException:
        raise


    # -----------------------------------------------------
    # UNEXPECTED ERRORS
    # -----------------------------------------------------

    except Exception as error:

        print(
            "[Voice] Unexpected analysis/database error:",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Voice analysis could not "
                "be completed."
            ),
        )


    # -----------------------------------------------------
    # CLEANUP
    # -----------------------------------------------------

    finally:

        try:

            if os.path.exists(
                temp_name
            ):

                os.remove(
                    temp_name
                )

                print(
                    "[Voice] Temporary file removed"
                )

        except PermissionError:

            print(
                "[Voice] Could not delete temporary file:",
                temp_name,
            )

        except Exception as cleanup_error:

            print(
                "[Voice] Temporary file cleanup warning:",
                repr(
                    cleanup_error
                ),
            )


# =========================================================
# VOICE HISTORY
# =========================================================

@router.get(
    "/voice-history"
)
def voice_history(
    limit: int = 10,
    user_id: str = Depends(
        get_current_user
    ),
):

    # Prevent extreme/unexpected limits.
    safe_limit = max(
        1,
        min(
            limit,
            50,
        ),
    )

    print(
        "[Voice History] Loading history"
    )

    print(
        "[Voice History] User:",
        user_id,
    )

    print(
        "[Voice History] Limit:",
        safe_limit,
    )


    try:

        history = get_voice_history(
            user_id=user_id,
            limit=safe_limit,
        )


        print(
            "[Voice History] Records found:",
            len(history),
        )


        # Helpful while debugging Phase 3.
        if history:

            newest = history[0]

            print(
                "[Voice History] Newest record:",
                {
                    "id":
                        newest.get(
                            "id"
                        ),

                    "acoustic_score":
                        newest.get(
                            "acoustic_score"
                        ),

                    "quality":
                        newest.get(
                            "quality"
                        ),

                    "model_status":
                        newest.get(
                            "model_status"
                        ),

                    "logged_at":
                        newest.get(
                            "logged_at"
                        ),
                },
            )


        return {
            "status":
                "success",

            "count":
                len(history),

            "history":
                history,
        }


    except Exception as error:

        print(
            "[Voice History] Database error:",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not load voice history."
            ),
        )


# =========================================================
# VOICE BASELINE
# =========================================================

@router.get(
    "/voice-baseline"
)
def voice_baseline(
    user_id: str = Depends(
        get_current_user
    ),
):
    """
    Build or refresh the user's personal acoustic baseline.

    Only:
    - experimental-natural-speech-v3
    - quality = good / acceptable

    recordings are eligible.

    This is an experimental acoustic baseline only.
    It must not be used for insulin dosing.
    """

    try:

        result = build_voice_baseline(
            user_id=user_id,
        )

        print(
            "[Voice Baseline API]",
            {
                "user_id":
                    user_id,

                "status":
                    result.get(
                        "status"
                    ),

                "sample_count":
                    result.get(
                        "sample_count"
                    ),
            },
        )

        return {
            **result,

            "model_status":
                "experimental-natural-speech-v3",

            "disclaimer": (
                "Experimental personal acoustic baseline only. "
                "It does not diagnose stress and must not be used "
                "to determine or change insulin dosing."
            ),
        }


    except Exception as error:

        print(
            "[Voice Baseline API] Error:",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not build the personal voice baseline."
            ),
        )


# =========================================================
# SAVED VOICE BASELINE
# =========================================================

@router.get(
    "/voice-baseline/saved"
)
def saved_voice_baseline(
    user_id: str = Depends(
        get_current_user
    ),
):
    """
    Read the most recently saved V3 personal baseline
    without recalculating it.
    """

    try:

        baseline = get_saved_baseline(
            user_id=user_id,
        )

        if baseline is None:

            return {
                "status":
                    "not_ready",

                "baseline":
                    None,

                "model_status":
                    "experimental-natural-speech-v3",
            }


        return {
            "status":
                "ready",

            "baseline":
                baseline,

            "model_status":
                "experimental-natural-speech-v3",

            "disclaimer": (
                "Experimental personal acoustic baseline only. "
                "It does not diagnose stress and must not be used "
                "to determine or change insulin dosing."
            ),
        }


    except Exception as error:

        print(
            "[Saved Voice Baseline] Error:",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not load the saved voice baseline."
            ),
        )

# ---------------------------------------------------------
# STRESS CONTEXT
# ---------------------------------------------------------

@router.get("/stress-context")
def stress_context(
    user_id: str = Depends(get_current_user),
):
    """
    Stress signal and advice from the latest reliable voice check in the
    last few hours. Used by the Dashboard and Bolus screens. Experimental:
    it shapes advice and never changes an insulin dose.
    """
    try:
        return get_stress_context(user_id)
    except Exception as error:
        print("[Stress Context Error]", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not load stress context.",
        )


@router.get("/stress-pattern")
def stress_pattern(
    user_id: str = Depends(get_current_user),
):
    """
    Stress over the last 7 days (is it ongoing?) and how stress has
    affected this user's own sugar over the last 30 days. Advice only:
    it never changes an insulin dose.
    """
    try:
        return get_stress_pattern(user_id)
    except Exception as error:
        print("[Stress Pattern Error]", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not load your stress pattern.",
        )
