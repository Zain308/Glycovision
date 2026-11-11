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
    / "glycovision_spike_final.joblib"
)

METADATA_FILE = (
    MODEL_DIR
    / "glycovision_spike_final_metadata.json"
)


# =========================================================
# CONFIG
# =========================================================

TARGET_COLUMN = "spike_risk_label"

DECISION_THRESHOLD = 0.30


EXCLUDED_COLUMNS = [
    "patient_id",
    "sample_time",

    # Future glucose values
    "target_bg_30m",
    "target_bg_60m",
    "future_peak_60m",
    "bg_rise_60m",

    # Training labels
    "spike_label",
    "hyperglycemia_crossing",
    "spike_risk_label",
]


# =========================================================
# LOAD DATA
# =========================================================

def load_dataset():

    print(
        "\nLoading final GlycoVision training dataset..."
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

    print(
        f"Columns: {len(df.columns)}"
    )

    return df


# =========================================================
# PREPARE FEATURES
# =========================================================

def prepare_data(
    df: pd.DataFrame,
):

    feature_columns = [
        column
        for column in df.columns
        if column not in EXCLUDED_COLUMNS
    ]

    X = df[
        feature_columns
    ].copy()

    y = (
        df[
            TARGET_COLUMN
        ]
        .astype(int)
    )

    return (
        X,
        y,
        feature_columns,
    )


# =========================================================
# FINAL MODEL
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

    (
        X,
        y,
        feature_columns,
    ) = prepare_data(
        df
    )


    print(
        "\n==========================================="
    )

    print(
        "FINAL TRAINING DATA"
    )

    print(
        "==========================================="
    )


    print(
        f"Samples: {len(X):,}"
    )


    print(
        f"Features: {len(feature_columns)}"
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
        "\nTraining final GlycoVision "
        "Random Forest..."
    )


    model = create_model()


    model.fit(
        X,
        y,
    )


    print(
        "\nFinal model training complete."
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
    # SAVE METADATA
    # -----------------------------------------------------

    metadata = {

        "model_name":
            "GlycoVision Spike Predictor",

        "model_version":
            "glycovision-spike-rf-final-v1",

        "model_type":
            "RandomForestClassifier",

        "prediction_horizon_minutes":
            60,

        "decision_threshold":
            DECISION_THRESHOLD,

        "threshold_origin":
            (
                "Nested patient-level cross-validation "
                "mean threshold approximately 0.296; "
                "deployment threshold rounded to 0.30."
            ),

        "target":
            TARGET_COLUMN,

        "training_samples":
            int(
                len(X)
            ),

        "training_patients":
            int(
                df["patient_id"]
                .nunique()
            ),

        "feature_count":
            len(
                feature_columns
            ),

        "feature_columns":
            feature_columns,

        "nested_cv": {

            "roc_auc_mean":
                0.7990,

            "roc_auc_std":
                0.0261,

            "pr_auc_mean":
                0.4866,

            "pr_auc_std":
                0.0475,

            "recall_mean":
                0.8285,

            "recall_std":
                0.0602,

            "precision_mean":
                0.2825,

            "precision_std":
                0.0600,

            "f1_mean":
                0.4164,

            "f1_std":
                0.0578,

            "f2_mean":
                0.5887,

            "f2_std":
                0.0319,
        },

        "trained_at":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "dataset":
            "HUPA-UCM Diabetes Dataset",

        "usage":
            (
                "Research prototype for estimating "
                "60-minute glucose spike/hyperglycemia risk."
            ),

        "limitations":
            [
                (
                    "False-positive rate remains substantial."
                ),
                (
                    "Predictions must not be interpreted "
                    "as guaranteed future glucose events."
                ),
                (
                    "Not intended for autonomous insulin dosing."
                ),
                (
                    "Requires approximately 60 minutes "
                    "of recent glucose/context data."
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


    # -----------------------------------------------------
    # DONE
    # -----------------------------------------------------

    print(
        "\n==========================================="
    )

    print(
        "FINAL MODEL SAVED"
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
        "\nFeatures:"
    )


    for feature in feature_columns:

        print(
            f"  - {feature}"
        )


if __name__ == "__main__":
    main()