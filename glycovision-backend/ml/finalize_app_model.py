from pathlib import Path
from datetime import datetime, timezone
import json

import joblib
import pandas as pd

from sklearn.ensemble import RandomForestClassifier


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATASET_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_features.csv"
)

MODEL_DIR = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
)

MODEL_FILE = (
    MODEL_DIR
    / "glycovision_spike_app_final.joblib"
)

METADATA_FILE = (
    MODEL_DIR
    / "glycovision_spike_app_final_metadata.json"
)


# =========================================================
# CONFIG
# =========================================================

TARGET_COLUMN = "spike_risk_label"

DECISION_THRESHOLD = 0.28


# =========================================================
# APP-COMPATIBLE FEATURES
# =========================================================

APP_FEATURES = [

    "glucose_t_minus_60",
    "glucose_t_minus_55",
    "glucose_t_minus_50",
    "glucose_t_minus_45",
    "glucose_t_minus_40",
    "glucose_t_minus_35",
    "glucose_t_minus_30",
    "glucose_t_minus_25",
    "glucose_t_minus_20",
    "glucose_t_minus_15",
    "glucose_t_minus_10",
    "glucose_t_minus_5",

    "current_bg",

    "bg_change_15m",
    "bg_change_30m",
    "bg_change_60m",

    "bg_mean_60m",
    "bg_std_60m",
    "bg_min_60m",
    "bg_max_60m",

    "carbs_60m",
    "bolus_60m",

    "hour_sin",
    "hour_cos",
]


# =========================================================
# LOAD DATA
# =========================================================

def load_dataset():

    print(
        "\nLoading app-model training dataset..."
    )

    df = pd.read_csv(
        DATASET_FILE
    )

    print(
        f"Rows: {len(df):,}"
    )

    print(
        f"Patients: "
        f"{df['patient_id'].nunique()}"
    )

    missing = [
        feature
        for feature in APP_FEATURES
        if feature not in df.columns
    ]

    if missing:

        raise ValueError(
            "Missing required features: "
            + ", ".join(missing)
        )

    return df


# =========================================================
# PREPARE
# =========================================================

def prepare_data(
    df: pd.DataFrame,
):

    X = df[
        APP_FEATURES
    ].copy()

    y = (
        df[
            TARGET_COLUMN
        ]
        .astype(int)
    )

    return X, y


# =========================================================
# MODEL
# =========================================================

def create_model():

    return RandomForestClassifier(

        n_estimators=300,

        max_depth=18,

        min_samples_split=10,

        min_samples_leaf=5,

        max_features="sqrt",

        class_weight="balanced",

        n_jobs=-1,

        random_state=42,

        verbose=1,
    )


# =========================================================
# MAIN
# =========================================================

def main():

    df = load_dataset()

    X, y = prepare_data(
        df
    )


    print(
        "\n==========================================="
    )

    print(
        "FINAL APP MODEL TRAINING"
    )

    print(
        "==========================================="
    )


    print(
        f"Samples: {len(X):,}"
    )

    print(
        f"Features: {len(APP_FEATURES)}"
    )


    print(
        "\nTarget distribution:"
    )

    print(
        y.value_counts()
    )


    print(
        "\nPositive rate:"
    )

    print(
        f"{y.mean() * 100:.2f}%"
    )


    # -----------------------------------------------------
    # TRAIN
    # -----------------------------------------------------

    print(
        "\nTraining final app-compatible Random Forest..."
    )


    model = create_model()


    model.fit(
        X,
        y,
    )


    print(
        "\nTraining complete."
    )


    # -----------------------------------------------------
    # SAVE MODEL
    # -----------------------------------------------------

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    joblib.dump(
        model,
        MODEL_FILE,
    )


    # -----------------------------------------------------
    # METADATA
    # -----------------------------------------------------

    metadata = {

        "model_name":
            "GlycoVision App Spike Predictor",

        "model_version":
            "glycovision-spike-app-final-v1",

        "model_type":
            "RandomForestClassifier",

        "prediction_horizon_minutes":
            60,

        "decision_threshold":
            DECISION_THRESHOLD,

        "threshold_origin":
            (
                "Nested patient-level evaluation. "
                "Median selected threshold = 0.28."
            ),

        "target":
            TARGET_COLUMN,

        "feature_count":
            len(APP_FEATURES),

        "feature_columns":
            APP_FEATURES,

        "training_samples":
            int(
                len(X)
            ),

        "training_patients":
            int(
                df["patient_id"]
                .nunique()
            ),

        "dataset":
            "HUPA-UCM Diabetes Dataset",

        "nested_evaluation": {

            "accuracy_mean":
                0.6179,

            "accuracy_std":
                0.0445,

            "precision_mean":
                0.2820,

            "precision_std":
                0.0584,

            "recall_mean":
                0.8346,

            "recall_std":
                0.0518,

            "f1_mean":
                0.4171,

            "f1_std":
                0.0606,

            "f2_mean":
                0.5912,

            "f2_std":
                0.0381,

            "roc_auc_mean":
                0.7986,

            "roc_auc_std":
                0.0267,

            "pr_auc_mean":
                0.4871,

            "pr_auc_std":
                0.0435,
        },

        "trained_at":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "purpose":
            (
                "Research model for estimating elevated "
                "60-minute glucose-rise risk."
            ),

        "limitations": [

            (
                "The model requires approximately "
                "60 minutes of recent glucose history."
            ),

            (
                "False-positive warnings remain substantial."
            ),

            (
                "The model has not been clinically validated."
            ),

            (
                "Predictions must not be used for "
                "autonomous insulin dosing."
            ),
        ],
    }


    with open(
        METADATA_FILE,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            metadata,
            file,
            indent=2,
        )


    print(
        "\n==========================================="
    )

    print(
        "FINAL APP MODEL SAVED"
    )

    print(
        "==========================================="
    )


    print(
        MODEL_FILE
    )


    print(
        "\nMetadata:"
    )

    print(
        METADATA_FILE
    )


    print(
        "\nDecision threshold:"
    )

    print(
        DECISION_THRESHOLD
    )


    print(
        "\nRequired features:"
    )


    for feature in APP_FEATURES:

        print(
            f"  - {feature}"
        )


if __name__ == "__main__":
    main()