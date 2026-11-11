from pathlib import Path
import json

import joblib
import pandas as pd


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_FILE = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
    / "glycovision_spike_final.joblib"
)

METADATA_FILE = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
    / "glycovision_spike_final_metadata.json"
)


# =========================================================
# LOAD MODEL + METADATA ONCE
# =========================================================

_model = None
_metadata = None


def _load_artifacts():

    global _model
    global _metadata

    if _model is None:

        if not MODEL_FILE.exists():
            raise FileNotFoundError(
                f"Spike prediction model not found: {MODEL_FILE}"
            )

        _model = joblib.load(
            MODEL_FILE
        )


    if _metadata is None:

        if not METADATA_FILE.exists():
            raise FileNotFoundError(
                f"Spike prediction metadata not found: {METADATA_FILE}"
            )

        with open(
            METADATA_FILE,
            "r",
            encoding="utf-8",
        ) as file:

            _metadata = json.load(
                file
            )


    return (
        _model,
        _metadata,
    )


# =========================================================
# RISK LEVEL
# =========================================================

def _get_risk_level(
    probability: float,
    threshold: float,
) -> str:

    # These are model-display bands,
    # NOT clinical thresholds.

    if probability < 0.15:
        return "low"

    if probability < threshold:
        return "moderate"

    return "elevated"


# =========================================================
# VALIDATE FEATURES
# =========================================================

def _validate_features(
    features: dict,
    required_features: list[str],
):

    missing = [
        feature
        for feature in required_features
        if feature not in features
    ]

    if missing:

        raise ValueError(
            "Missing required spike-prediction features: "
            + ", ".join(missing)
        )


    invalid = []

    for feature in required_features:

        value = features.get(
            feature
        )

        if value is None:
            invalid.append(
                feature
            )

    if invalid:

        raise ValueError(
            "Spike-prediction features cannot be null: "
            + ", ".join(invalid)
        )


# =========================================================
# PREDICTION
# =========================================================

def predict_spike(
    features: dict,
) -> dict:

    model, metadata = (
        _load_artifacts()
    )


    required_features = (
        metadata[
            "feature_columns"
        ]
    )


    threshold = float(
        metadata[
            "decision_threshold"
        ]
    )


    _validate_features(
        features,
        required_features,
    )


    ordered_features = {

        feature:
            float(
                features[
                    feature
                ]
            )

        for feature in required_features
    }


    X = pd.DataFrame(
        [
            ordered_features
        ],
        columns=required_features,
    )


    probability = float(
        model.predict_proba(
            X
        )[0][1]
    )


    spike_risk = bool(
        probability
        >= threshold
    )


    risk_level = (
        _get_risk_level(
            probability,
            threshold,
        )
    )


    return {

        "status":
            "success",

        "prediction_horizon_minutes":
            int(
                metadata.get(
                    "prediction_horizon_minutes",
                    60,
                )
            ),

        "risk_score":
            round(
                probability,
                4,
            ),

        "risk_percent":
            round(
                probability
                * 100,
                1,
            ),

        "spike_risk":
            spike_risk,

        "risk_level":
            risk_level,

        "decision_threshold":
            threshold,

        "model_version":
            metadata[
                "model_version"
            ],

        "feature_count":
            len(
                required_features
            ),

        "disclaimer":
            (
                "Research prediction only. "
                "This output is not a treatment recommendation "
                "and must not be used for autonomous insulin dosing."
            ),
    }


# =========================================================
# MODEL INFO
# =========================================================

def get_spike_model_info() -> dict:

    _, metadata = (
        _load_artifacts()
    )


    return {

        "model_name":
            metadata.get(
                "model_name"
            ),

        "model_version":
            metadata.get(
                "model_version"
            ),

        "model_type":
            metadata.get(
                "model_type"
            ),

        "prediction_horizon_minutes":
            metadata.get(
                "prediction_horizon_minutes"
            ),

        "decision_threshold":
            metadata.get(
                "decision_threshold"
            ),

        "feature_count":
            len(
                metadata.get(
                    "feature_columns",
                    [],
                )
            ),

        "nested_cv":
            metadata.get(
                "nested_cv",
                {},
            ),
    }