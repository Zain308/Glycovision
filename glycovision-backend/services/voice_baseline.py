import math
import statistics
from typing import Optional

from core.db import get_db


# =========================================================
# CONFIGURATION
# =========================================================

VOICE_MODEL_VERSION = "experimental-natural-speech-v3"

VALID_QUALITIES = [
    "good",
    "acceptable",
]

# Development/research threshold.
# This is NOT a clinically validated sample requirement.
MIN_BASELINE_SAMPLES = 5

# Avoid letting an unlimited history become our baseline.
MAX_BASELINE_SAMPLES = 30


# =========================================================
# HELPERS
# =========================================================

def _valid_number(value) -> bool:
    try:
        return (
            value is not None
            and math.isfinite(float(value))
        )
    except (TypeError, ValueError):
        return False


def _median(
    values: list[float],
) -> Optional[float]:

    clean_values = [
        float(value)
        for value in values
        if _valid_number(value)
    ]

    if not clean_values:
        return None

    return round(
        statistics.median(clean_values),
        3,
    )


def _mad(
    values: list[float],
) -> Optional[float]:
    """
    Median Absolute Deviation.

    Provides a robust estimate of how much a
    user's recordings normally vary.
    """

    clean_values = [
        float(value)
        for value in values
        if _valid_number(value)
    ]

    if not clean_values:
        return None

    center = statistics.median(
        clean_values
    )

    deviations = [
        abs(value - center)
        for value in clean_values
    ]

    return round(
        statistics.median(deviations),
        3,
    )


# =========================================================
# LOAD ELIGIBLE RECORDINGS
# =========================================================

def get_baseline_samples(
    user_id: str,
    limit: int = MAX_BASELINE_SAMPLES,
) -> list[dict]:

    db = get_db()

    safe_limit = max(
        1,
        min(
            limit,
            MAX_BASELINE_SAMPLES,
        ),
    )

    response = (
        db.table("stress_logs")
        .select(
            "id,"
            "acoustic_score,"
            "f0_mean,"
            "f0_std,"
            "hnr,"
            "voiced_ratio,"
            "quality,"
            "model_status,"
            "logged_at"
        )
        .eq(
            "user_id",
            user_id,
        )
        .eq(
            "model_status",
            VOICE_MODEL_VERSION,
        )
        .in_(
            "quality",
            VALID_QUALITIES,
        )
        .order(
            "logged_at",
            desc=True,
        )
        .limit(
            safe_limit
        )
        .execute()
    )

    return response.data or []


# =========================================================
# CALCULATE BASELINE
# =========================================================

def calculate_baseline(
    samples: list[dict],
) -> dict:

    sample_count = len(samples)

    if sample_count < MIN_BASELINE_SAMPLES:

        return {
            "status": "collecting",
            "sample_count": sample_count,
            "required_samples": MIN_BASELINE_SAMPLES,
            "remaining_samples": (
                MIN_BASELINE_SAMPLES
                - sample_count
            ),
            "baseline": None,
        }

    features = {
        "f0_mean": [],
        "f0_std": [],
        "hnr": [],
        "voiced_ratio": [],
        "acoustic_score": [],
    }

    for sample in samples:

        for feature in features:

            value = sample.get(
                feature
            )

            if _valid_number(value):

                features[
                    feature
                ].append(
                    float(value)
                )

    baseline = {}

    for feature, values in features.items():

        baseline[
            f"{feature}_median"
        ] = _median(
            values
        )

        baseline[
            f"{feature}_mad"
        ] = _mad(
            values
        )

    return {
        "status": "ready",
        "sample_count": sample_count,
        "required_samples": MIN_BASELINE_SAMPLES,
        "remaining_samples": 0,
        "baseline": baseline,
    }


# =========================================================
# SAVE / UPDATE BASELINE
# =========================================================

def save_baseline(
    user_id: str,
    baseline_result: dict,
) -> dict:

    if (
        baseline_result.get("status")
        != "ready"
    ):
        return baseline_result

    db = get_db()

    baseline = baseline_result[
        "baseline"
    ]

    payload = {
        "user_id":
            user_id,

        "model_status":
            VOICE_MODEL_VERSION,

        "sample_count":
            baseline_result[
                "sample_count"
            ],

        "f0_mean_median":
            baseline[
                "f0_mean_median"
            ],

        "f0_std_median":
            baseline[
                "f0_std_median"
            ],

        "hnr_median":
            baseline[
                "hnr_median"
            ],

        "voiced_ratio_median":
            baseline[
                "voiced_ratio_median"
            ],

        "acoustic_score_median":
            baseline[
                "acoustic_score_median"
            ],

        "f0_mean_mad":
            baseline[
                "f0_mean_mad"
            ],

        "f0_std_mad":
            baseline[
                "f0_std_mad"
            ],

        "hnr_mad":
            baseline[
                "hnr_mad"
            ],

        "voiced_ratio_mad":
            baseline[
                "voiced_ratio_mad"
            ],

        "acoustic_score_mad":
            baseline[
                "acoustic_score_mad"
            ],
    }

    response = (
        db.table(
            "voice_baselines"
        )
        .upsert(
            payload,
            on_conflict=(
                "user_id,"
                "model_status"
            ),
        )
        .execute()
    )

    return {
        **baseline_result,
        "saved": True,
        "database_record":
            (
                response.data[0]
                if response.data
                else None
            ),
    }


# =========================================================
# BUILD / REFRESH USER BASELINE
# =========================================================

def build_voice_baseline(
    user_id: str,
) -> dict:

    samples = get_baseline_samples(
        user_id=user_id,
    )

    result = calculate_baseline(
        samples
    )

    print(
        "[Voice Baseline]",
        {
            "user_id": user_id,
            "eligible_samples":
                len(samples),
            "status":
                result["status"],
        },
    )

    if (
        result["status"]
        == "ready"
    ):

        result = save_baseline(
            user_id=user_id,
            baseline_result=result,
        )

    return result


# =========================================================
# READ SAVED BASELINE
# =========================================================

def get_saved_baseline(
    user_id: str,
) -> Optional[dict]:

    db = get_db()

    response = (
        db.table(
            "voice_baselines"
        )
        .select("*")
        .eq(
            "user_id",
            user_id,
        )
        .eq(
            "model_status",
            VOICE_MODEL_VERSION,
        )
        .limit(1)
        .execute()
    )

    rows = response.data or []

    if not rows:
        return None

    return rows[0]