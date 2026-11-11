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
    / "glycovision_spike_sparse_final.joblib"
)

METADATA_FILE = (
    MODEL_DIR
    / "glycovision_spike_sparse_final_metadata.json"
)


# =========================================================
# CONFIG
# =========================================================

TARGET_COLUMN = "spike_risk_label"

# Nested sparse evaluation:
# thresholds = 0.26, 0.30, 0.26, 0.28, 0.28
# median threshold = 0.28
DECISION_THRESHOLD = 0.28


# =========================================================
# SPARSE / MANUAL-BG FEATURES
# =========================================================

SPARSE_FEATURES = [
    "current_bg",

    "glucose_t_minus_15",
    "glucose_t_minus_30",
    "glucose_t_minus_60",

    "bg_change_15m",
    "bg_change_30m",
    "bg_change_60m",

    "carbs_60m",
    "bolus_60m",

    "hour_sin",
    "hour_cos",
]


# =========================================================
# LOAD DATASET
# =========================================================

def load_dataset():

    print(
        "\nLoading sparse-model training dataset..."
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
        f"Columns: "
        f"{len(df.columns)}"
    )

    missing = [
        feature
        for feature in SPARSE_FEATURES
        if feature not in df.columns
    ]

    if missing:

        raise ValueError(
            "Missing required sparse features: "
            + ", ".join(missing)
        )

    if TARGET_COLUMN not in df.columns:

        raise ValueError(
            f"Target column '{TARGET_COLUMN}' "
            "not found in dataset."
        )

    return df


# =========================================================
# PREPARE DATA
# =========================================================

def prepare_data(
    df: pd.DataFrame,
):

    X = (
        df[
            SPARSE_FEATURES
        ]
        .copy()
    )

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
        "FINAL SPARSE MODEL TRAINING"
    )

    print(
        "==========================================="
    )


    print(
        f"Samples: {len(X):,}"
    )

    print(
        f"Features: {len(SPARSE_FEATURES)}"
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


    print(
        "\nRequired sparse features:"
    )

    for feature in SPARSE_FEATURES:

        print(
            f"  - {feature}"
        )


    # -----------------------------------------------------
    # TRAIN FINAL MODEL
    # -----------------------------------------------------

    print(
        "\nTraining final sparse/manual-BG Random Forest..."
    )


    model = create_model()


    model.fit(
        X,
        y,
    )


    print(
        "\nFinal sparse model training complete."
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
    # FEATURE IMPORTANCE
    # -----------------------------------------------------

    importance_df = pd.DataFrame({
        "feature":
            SPARSE_FEATURES,

        "importance":
            model.feature_importances_,
    })


    importance_df = (
        importance_df
        .sort_values(
            "importance",
            ascending=False,
        )
    )


    importance_file = (
        MODEL_DIR
        / "sparse_model_feature_importance.csv"
    )


    importance_df.to_csv(
        importance_file,
        index=False,
    )


    print(
        "\n==========================================="
    )

    print(
        "TOP SPARSE MODEL FEATURES"
    )

    print(
        "==========================================="
    )


    print(
        importance_df.to_string(
            index=False
        )
    )


    # -----------------------------------------------------
    # METADATA
    # -----------------------------------------------------

    metadata = {

        "model_name":
            "GlycoVision Sparse BG Spike Predictor",

        "model_version":
            "glycovision-spike-sparse-final-v1",

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
            len(
                SPARSE_FEATURES
            ),

        "feature_columns":
            SPARSE_FEATURES,

        "training_samples":
            int(
                len(X)
            ),

        "training_patients":
            int(
                df[
                    "patient_id"
                ].nunique()
            ),

        "positive_rate":
            float(
                y.mean()
            ),

        "dataset":
            "HUPA-UCM Diabetes Dataset",

        "nested_evaluation": {

            "accuracy_mean":
                0.6030,

            "accuracy_std":
                0.0664,

            "precision_mean":
                0.2769,

            "precision_std":
                0.0649,

            "recall_mean":
                0.8368,

            "recall_std":
                0.0654,

            "f1_mean":
                0.4102,

            "f1_std":
                0.0667,

            "f2_mean":
                0.5844,

            "f2_std":
                0.0399,

            "roc_auc_mean":
                0.7947,

            "roc_auc_std":
                0.0274,

            "pr_auc_mean":
                0.4773,

            "pr_auc_std":
                0.0456,
        },

        "nested_thresholds":
            [
                0.26,
                0.30,
                0.26,
                0.28,
                0.28,
            ],

        "nested_threshold_mean":
            0.276,

        "nested_threshold_median":
            0.28,

        "trained_at":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "purpose":
            (
                "Research fallback model for users with "
                "sparse/manual glucose history. Uses current "
                "BG plus approximately 15, 30 and 60-minute "
                "glucose anchors, recent carbs, recent bolus "
                "and time-of-day features."
            ),

        "limitations": [

            (
                "The model was trained using CGM-derived "
                "HUPA-UCM samples, while manual BG readings "
                "may have different timing and measurement "
                "characteristics."
            ),

            (
                "The model has relatively high recall but "
                "low precision and can generate false-positive "
                "risk warnings."
            ),

            (
                "The model has not been clinically validated."
            ),

            (
                "Predictions must not be used for autonomous "
                "insulin dosing or treatment decisions."
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
    # FINAL REPORT
    # -----------------------------------------------------

    print(
        "\n==========================================="
    )

    print(
        "FINAL SPARSE MODEL SAVED"
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
        "\nFeature importance:"
    )

    print(
        importance_file
    )


    print(
        "\nDecision threshold:"
    )

    print(
        DECISION_THRESHOLD
    )


    print(
        "\nModel version:"
    )

    print(
        metadata[
            "model_version"
        ]
    )


if __name__ == "__main__":
    main()