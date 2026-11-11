import math
from typing import Optional

from services.voice_baseline import (
    get_saved_baseline,
    VOICE_MODEL_VERSION,
)


# =========================================================
# CONFIGURATION
# =========================================================

# Robust deviation thresholds.
# These are engineering thresholds for the prototype,
# not clinically validated cutoffs.
MILD_DEVIATION_THRESHOLD = 1.5
STRONG_DEVIATION_THRESHOLD = 3.0

# Prevent tiny MAD values from causing huge deviation scores.
MAD_FLOOR = {
    "f0_mean": 5.0,
    "f0_std": 2.0,
    "hnr": 1.5,
    "voiced_ratio": 0.05,
    "acoustic_score": 0.05,
}


# =========================================================
# HELPERS
# =========================================================

def _is_valid_number(value) -> bool:
    try:
        return (
            value is not None
            and math.isfinite(float(value))
        )
    except (TypeError, ValueError):
        return False


def _robust_deviation(
    value: float,
    median: float,
    mad: float,
    mad_floor: float,
) -> float:
    """
    Robust deviation using a stabilized MAD denominator.

    We intentionally floor MAD so a nearly identical
    baseline does not create unrealistic huge deviations.
    """

    effective_mad = max(
        abs(float(mad)),
        mad_floor,
    )

    deviation = abs(
        float(value) - float(median)
    ) / effective_mad

    return round(deviation, 3)


# =========================================================
# FEATURE COMPARISON
# =========================================================

def compare_feature(
    *,
    feature_name: str,
    value: float,
    baseline: dict,
) -> Optional[dict]:

    median_key = f"{feature_name}_median"
    mad_key = f"{feature_name}_mad"

    median = baseline.get(median_key)
    mad = baseline.get(mad_key)

    if not (
        _is_valid_number(value)
        and _is_valid_number(median)
        and _is_valid_number(mad)
    ):
        return None

    deviation = _robust_deviation(
        value=float(value),
        median=float(median),
        mad=float(mad),
        mad_floor=MAD_FLOOR[feature_name],
    )

    if deviation < MILD_DEVIATION_THRESHOLD:
        level = "similar"

    elif deviation < STRONG_DEVIATION_THRESHOLD:
        level = "mildly_different"

    else:
        level = "different"

    return {
        "feature": feature_name,
        "current_value": round(float(value), 3),
        "baseline_median": round(float(median), 3),
        "baseline_mad": round(float(mad), 3),
        "deviation_score": deviation,
        "level": level,
    }


# =========================================================
# OVERALL PERSONAL DEVIATION
# =========================================================

def compare_to_personal_baseline(
    user_id: str,
    voice_result: dict,
) -> dict:
    """
    Compare one valid V3 recording against the user's
    previously saved V3 personal acoustic baseline.

    This is NOT a stress diagnosis.
    This must NOT be used for insulin dosing.
    """

    model_status = voice_result.get("model_status")
    quality = voice_result.get("quality")

    if model_status != VOICE_MODEL_VERSION:
        return {
            "status": "unsupported_model",
            "comparison_ready": False,
            "reason": (
                "This recording was not processed with "
                "the current voice model version."
            ),
        }

    if quality not in {"good", "acceptable"}:
        return {
            "status": "limited_recording",
            "comparison_ready": False,
            "reason": (
                "This recording did not meet the reliability "
                "requirements for personal baseline comparison."
            ),
        }

    baseline_record = get_saved_baseline(
        user_id=user_id,
    )

    if baseline_record is None:
        return {
            "status": "baseline_not_ready",
            "comparison_ready": False,
            "reason": (
                "A personal acoustic baseline has not "
                "been established yet."
            ),
        }

    feature_results = []

    feature_mapping = {
        "f0_mean": voice_result.get("f0_mean"),
        "f0_std": voice_result.get("f0_std"),
        "hnr": voice_result.get("hnr"),
        "voiced_ratio": voice_result.get("voiced_ratio"),
    }

    for feature_name, value in feature_mapping.items():

        comparison = compare_feature(
            feature_name=feature_name,
            value=value,
            baseline=baseline_record,
        )

        if comparison is not None:
            feature_results.append(
                comparison
            )

    if not feature_results:
        return {
            "status": "insufficient_features",
            "comparison_ready": False,
            "reason": (
                "Not enough valid acoustic features were "
                "available for baseline comparison."
            ),
        }

    # -----------------------------------------------------
    # Aggregate deviation
    # -----------------------------------------------------

    deviation_scores = [
        item["deviation_score"]
        for item in feature_results
    ]

    overall_deviation = (
        sum(deviation_scores)
        / len(deviation_scores)
    )

    overall_deviation = round(
        overall_deviation,
        3,
    )

    different_features = [
        item
        for item in feature_results
        if item["level"] == "different"
    ]

    mildly_different_features = [
        item
        for item in feature_results
        if item["level"] == "mildly_different"
    ]

    # -----------------------------------------------------
    # Overall label
    # -----------------------------------------------------

    if (
        overall_deviation >= STRONG_DEVIATION_THRESHOLD
        or len(different_features) >= 2
    ):
        pattern = "different"

    elif (
        overall_deviation >= MILD_DEVIATION_THRESHOLD
        or len(mildly_different_features) >= 2
        or len(different_features) == 1
    ):
        pattern = "mildly_different"

    else:
        pattern = "similar"

    # -----------------------------------------------------
    # Patient-facing interpretation
    # -----------------------------------------------------

    if pattern == "similar":

        interpretation = (
            "This recording is similar to your recent "
            "personal acoustic pattern."
        )

    elif pattern == "mildly_different":

        interpretation = (
            "Some acoustic characteristics in this recording "
            "differ from your recent personal pattern."
        )

    else:

        interpretation = (
            "This recording differs noticeably from your "
            "recent personal acoustic pattern."
        )

    return {
        "status": "ready",
        "comparison_ready": True,

        "pattern": pattern,

        "overall_deviation_score":
            overall_deviation,

        "feature_comparisons":
            feature_results,

        "baseline_sample_count":
            baseline_record.get(
                "sample_count"
            ),

        "model_status":
            VOICE_MODEL_VERSION,

        "interpretation":
            interpretation,

        "disclaimer": (
            "Experimental personal acoustic comparison only. "
            "This result does not diagnose stress, illness, "
            "or glucose status and must not be used to "
            "determine or change insulin dosing."
        ),
    }