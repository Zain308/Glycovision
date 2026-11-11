from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    fbeta_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    classification_report,
)


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

FEATURE_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_features.csv"
)

ARTIFACT_DIR = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
)

MODEL_FILE = (
    ARTIFACT_DIR
    / "spike_rf.joblib"
)

METADATA_FILE = (
    ARTIFACT_DIR
    / "spike_rf_metadata.json"
)


# =========================================================
# TARGET
# =========================================================

TARGET_COLUMN = "spike_risk_label"


# =========================================================
# COLUMNS THAT MUST NEVER ENTER THE MODEL
# =========================================================

LEAKAGE_COLUMNS = [
    "patient_id",
    "sample_time",

    # Future information
    "target_bg_30m",
    "target_bg_60m",
    "future_peak_60m",
    "bg_rise_60m",

    # Labels
    "spike_label",
    "hyperglycemia_crossing",
    "spike_risk_label",
]


# =========================================================
# LOAD DATA
# =========================================================

def load_dataset():

    print(
        "\nLoading GlycoVision feature dataset..."
    )

    df = pd.read_csv(
        FEATURE_FILE
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
# PATIENT-LEVEL SPLIT
# =========================================================

def patient_split(
    df: pd.DataFrame,
):

    patients = sorted(
        df["patient_id"].unique()
    )


    test_patients = [
        "HUPA0004P",
        "HUPA0018P",
        "HUPA0028P",
    ]


    validation_patients = [
        "HUPA0007P",
        "HUPA0016P",
        "HUPA0026P",
    ]


    train_patients = [
        patient
        for patient in patients
        if patient not in test_patients
        and patient not in validation_patients
    ]


    train_df = df[
        df["patient_id"].isin(
            train_patients
        )
    ].copy()


    validation_df = df[
        df["patient_id"].isin(
            validation_patients
        )
    ].copy()


    test_df = df[
        df["patient_id"].isin(
            test_patients
        )
    ].copy()


    print(
        "\n==========================================="
    )

    print(
        "PATIENT SPLIT"
    )

    print(
        "==========================================="
    )


    print(
        f"Train patients: "
        f"{len(train_patients)}"
    )

    print(
        f"Validation patients: "
        f"{len(validation_patients)}"
    )

    print(
        f"Test patients: "
        f"{len(test_patients)}"
    )


    print(
        f"\nTrain rows: "
        f"{len(train_df):,}"
    )

    print(
        f"Validation rows: "
        f"{len(validation_df):,}"
    )

    print(
        f"Test rows: "
        f"{len(test_df):,}"
    )


    return (
        train_df,
        validation_df,
        test_df,
        train_patients,
        validation_patients,
        test_patients,
    )


# =========================================================
# PREPARE FEATURES
# =========================================================

def prepare_xy(
    df: pd.DataFrame,
):

    feature_columns = [
        column
        for column in df.columns
        if column not in LEAKAGE_COLUMNS
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
# THRESHOLD EVALUATION
# =========================================================

def metrics_at_threshold(
    y_true,
    probabilities,
    threshold: float,
):

    predictions = (
        probabilities
        >= threshold
    ).astype(int)


    return {

        "threshold":
            float(threshold),

        "accuracy":
            float(
                accuracy_score(
                    y_true,
                    predictions,
                )
            ),

        "precision":
            float(
                precision_score(
                    y_true,
                    predictions,
                    zero_division=0,
                )
            ),

        "recall":
            float(
                recall_score(
                    y_true,
                    predictions,
                    zero_division=0,
                )
            ),

        "f1":
            float(
                f1_score(
                    y_true,
                    predictions,
                    zero_division=0,
                )
            ),

        # F2 gives recall more importance
        # than precision.
        "f2":
            float(
                fbeta_score(
                    y_true,
                    predictions,
                    beta=2,
                    zero_division=0,
                )
            ),
    }


# =========================================================
# FIND BEST THRESHOLD
# =========================================================

def find_best_threshold(
    y_validation,
    validation_probabilities,
):

    print(
        "\n==========================================="
    )

    print(
        "THRESHOLD TUNING — VALIDATION SET"
    )

    print(
        "==========================================="
    )


    thresholds = np.arange(
        0.10,
        0.81,
        0.02,
    )


    results = []


    for threshold in thresholds:

        result = metrics_at_threshold(
            y_validation,
            validation_probabilities,
            threshold,
        )

        results.append(
            result
        )


    results_df = pd.DataFrame(
        results
    )


    print(
        "\nThreshold comparison:"
    )


    print(
        results_df[
            [
                "threshold",
                "precision",
                "recall",
                "f1",
                "f2",
                "accuracy",
            ]
        ].to_string(
            index=False,
            formatters={
                "threshold":
                    "{:.2f}".format,

                "precision":
                    "{:.4f}".format,

                "recall":
                    "{:.4f}".format,

                "f1":
                    "{:.4f}".format,

                "f2":
                    "{:.4f}".format,

                "accuracy":
                    "{:.4f}".format,
            },
        )
    )


    # -----------------------------------------------------
    # Select threshold with highest F2 score.
    #
    # F2 weights recall more strongly because missing
    # an upcoming spike-risk event is important in our
    # research use case.
    # -----------------------------------------------------

    best_index = (
        results_df[
            "f2"
        ].idxmax()
    )


    best = (
        results_df.loc[
            best_index
        ]
    )


    best_threshold = float(
        best["threshold"]
    )


    print(
        "\n-------------------------------------------"
    )

    print(
        "SELECTED THRESHOLD"
    )

    print(
        "-------------------------------------------"
    )


    print(
        f"Threshold: "
        f"{best_threshold:.2f}"
    )

    print(
        f"Precision: "
        f"{best['precision']:.4f}"
    )

    print(
        f"Recall: "
        f"{best['recall']:.4f}"
    )

    print(
        f"F1: "
        f"{best['f1']:.4f}"
    )

    print(
        f"F2: "
        f"{best['f2']:.4f}"
    )


    return (
        best_threshold,
        results,
    )


# =========================================================
# FINAL EVALUATION
# =========================================================

def evaluate_model(
    model,
    X,
    y,
    split_name: str,
    threshold: float,
):

    print(
        "\n==========================================="
    )

    print(
        f"{split_name.upper()} RESULTS"
    )

    print(
        "==========================================="
    )


    probabilities = (
        model.predict_proba(
            X
        )[:, 1]
    )


    predictions = (
        probabilities
        >= threshold
    ).astype(int)


    accuracy = accuracy_score(
        y,
        predictions,
    )


    precision = precision_score(
        y,
        predictions,
        zero_division=0,
    )


    recall = recall_score(
        y,
        predictions,
        zero_division=0,
    )


    f1 = f1_score(
        y,
        predictions,
        zero_division=0,
    )


    f2 = fbeta_score(
        y,
        predictions,
        beta=2,
        zero_division=0,
    )


    roc_auc = roc_auc_score(
        y,
        probabilities,
    )


    pr_auc = average_precision_score(
        y,
        probabilities,
    )


    cm = confusion_matrix(
        y,
        predictions,
    )


    print(
        f"Threshold: {threshold:.2f}"
    )

    print(
        f"Accuracy:  {accuracy:.4f}"
    )

    print(
        f"Precision: {precision:.4f}"
    )

    print(
        f"Recall:    {recall:.4f}"
    )

    print(
        f"F1 Score:  {f1:.4f}"
    )

    print(
        f"F2 Score:  {f2:.4f}"
    )

    print(
        f"ROC-AUC:   {roc_auc:.4f}"
    )

    print(
        f"PR-AUC:    {pr_auc:.4f}"
    )


    print(
        "\nConfusion Matrix:"
    )

    print(
        cm
    )


    print(
        "\nClassification Report:"
    )

    print(
        classification_report(
            y,
            predictions,
            digits=4,
            zero_division=0,
        )
    )


    return {

        "threshold":
            float(threshold),

        "accuracy":
            float(accuracy),

        "precision":
            float(precision),

        "recall":
            float(recall),

        "f1":
            float(f1),

        "f2":
            float(f2),

        "roc_auc":
            float(roc_auc),

        "pr_auc":
            float(pr_auc),

        "confusion_matrix":
            cm.tolist(),
    }


# =========================================================
# FEATURE IMPORTANCE
# =========================================================

def print_feature_importance(
    model,
    feature_columns,
    top_n=20,
):

    importance_df = pd.DataFrame({

        "feature":
            feature_columns,

        "importance":
            model.feature_importances_,
    })


    importance_df = (
        importance_df
        .sort_values(
            "importance",
            ascending=False,
        )
        .head(
            top_n
        )
    )


    print(
        "\n==========================================="
    )

    print(
        "TOP FEATURE IMPORTANCE"
    )

    print(
        "==========================================="
    )


    print(
        importance_df.to_string(
            index=False
        )
    )


    return importance_df


# =========================================================
# MAIN
# =========================================================

def main():

    # -----------------------------------------------------
    # LOAD
    # -----------------------------------------------------

    df = load_dataset()


    # -----------------------------------------------------
    # SPLIT BY PATIENT
    # -----------------------------------------------------

    (
        train_df,
        validation_df,
        test_df,
        train_patients,
        validation_patients,
        test_patients,
    ) = patient_split(
        df
    )


    # -----------------------------------------------------
    # TRAIN DATA
    # -----------------------------------------------------

    (
        X_train,
        y_train,
        feature_columns,
    ) = prepare_xy(
        train_df
    )


    # -----------------------------------------------------
    # VALIDATION DATA
    # -----------------------------------------------------

    X_validation = (
        validation_df[
            feature_columns
        ].copy()
    )


    y_validation = (
        validation_df[
            TARGET_COLUMN
        ].astype(int)
    )


    # -----------------------------------------------------
    # TEST DATA
    # -----------------------------------------------------

    X_test = (
        test_df[
            feature_columns
        ].copy()
    )


    y_test = (
        test_df[
            TARGET_COLUMN
        ].astype(int)
    )


    # -----------------------------------------------------
    # DISTRIBUTION
    # -----------------------------------------------------

    print(
        "\n==========================================="
    )

    print(
        "TRAIN TARGET DISTRIBUTION"
    )

    print(
        "==========================================="
    )


    print(
        y_train.value_counts()
    )


    print(
        "\nPositive rate:"
    )


    print(
        f"{y_train.mean() * 100:.2f}%"
    )


    # -----------------------------------------------------
    # RANDOM FOREST
    # -----------------------------------------------------

    print(
        "\nTraining Random Forest..."
    )


    model = RandomForestClassifier(

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


    model.fit(
        X_train,
        y_train,
    )


    print(
        "\nTraining complete."
    )


    # -----------------------------------------------------
    # GET VALIDATION PROBABILITIES
    # -----------------------------------------------------

    validation_probabilities = (
        model.predict_proba(
            X_validation
        )[:, 1]
    )


    # -----------------------------------------------------
    # FIND THRESHOLD USING VALIDATION ONLY
    # -----------------------------------------------------

    (
        best_threshold,
        threshold_results,
    ) = find_best_threshold(
        y_validation,
        validation_probabilities,
    )


    # -----------------------------------------------------
    # VALIDATION WITH CHOSEN THRESHOLD
    # -----------------------------------------------------

    validation_metrics = (
        evaluate_model(
            model,
            X_validation,
            y_validation,
            "validation",
            best_threshold,
        )
    )


    # -----------------------------------------------------
    # TEST WITH SAME FIXED THRESHOLD
    # -----------------------------------------------------

    test_metrics = (
        evaluate_model(
            model,
            X_test,
            y_test,
            "test",
            best_threshold,
        )
    )


    # -----------------------------------------------------
    # FEATURE IMPORTANCE
    # -----------------------------------------------------

    importance_df = (
        print_feature_importance(
            model,
            feature_columns,
        )
    )


    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    ARTIFACT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    joblib.dump(
        model,
        MODEL_FILE,
    )


    metadata = {

        "model_type":
            "RandomForestClassifier",

        "model_version":
            "glycovision-spike-rf-v2",

        "target":
            TARGET_COLUMN,

        "prediction_horizon_minutes":
            60,

        "decision_threshold":
            best_threshold,

        "threshold_selection":
            (
                "Selected on validation patients "
                "using maximum F2 score."
            ),

        "feature_columns":
            feature_columns,

        "train_patients":
            train_patients,

        "validation_patients":
            validation_patients,

        "test_patients":
            test_patients,

        "validation_metrics":
            validation_metrics,

        "test_metrics":
            test_metrics,

        "threshold_search":
            threshold_results,

        "positive_class":
            (
                "meaningful glucose rise or "
                "upcoming crossing above 180 mg/dL "
                "within 60 minutes"
            ),

        "notes":
            (
                "Research prototype only. "
                "Not intended for insulin dosing "
                "or autonomous clinical decisions."
            ),
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
    # SAVE FEATURE IMPORTANCE
    # -----------------------------------------------------

    importance_file = (
        ARTIFACT_DIR
        / "feature_importance.csv"
    )


    importance_df.to_csv(
        importance_file,
        index=False,
    )


    print(
        "\n==========================================="
    )

    print(
        "MODEL SAVED"
    )

    print(
        "==========================================="
    )


    print(
        MODEL_FILE
    )


    print(
        "\nMetadata saved:"
    )

    print(
        METADATA_FILE
    )


    print(
        "\nFeature importance saved:"
    )

    print(
        importance_file
    )


    print(
        "\nSelected decision threshold:"
    )

    print(
        f"{best_threshold:.2f}"
    )


if __name__ == "__main__":
    main()