from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd

from xgboost import XGBClassifier

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
    / "spike_xgboost.joblib"
)

METADATA_FILE = (
    ARTIFACT_DIR
    / "spike_xgboost_metadata.json"
)


# =========================================================
# TARGET
# =========================================================

TARGET_COLUMN = "spike_risk_label"


# =========================================================
# DATA LEAKAGE COLUMNS
# =========================================================

LEAKAGE_COLUMNS = [
    "patient_id",
    "sample_time",

    # Future data
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

    print("\nLoading GlycoVision dataset...")

    df = pd.read_csv(
        FEATURE_FILE
    )

    print(
        f"Rows: {len(df):,}"
    )

    print(
        f"Patients: {df['patient_id'].nunique()}"
    )

    print(
        f"Columns: {len(df.columns)}"
    )

    return df


# =========================================================
# SAME PATIENT SPLIT AS RANDOM FOREST
# =========================================================

def patient_split(df):

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

    all_patients = sorted(
        df["patient_id"].unique()
    )

    train_patients = [
        patient
        for patient in all_patients
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

    print("\n===========================================")
    print("PATIENT SPLIT")
    print("===========================================")

    print(
        f"Train patients: {len(train_patients)}"
    )

    print(
        f"Validation patients: {len(validation_patients)}"
    )

    print(
        f"Test patients: {len(test_patients)}"
    )

    print(
        f"\nTrain rows: {len(train_df):,}"
    )

    print(
        f"Validation rows: {len(validation_df):,}"
    )

    print(
        f"Test rows: {len(test_df):,}"
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
# FEATURE PREPARATION
# =========================================================

def prepare_xy(df):

    feature_columns = [
        column
        for column in df.columns
        if column not in LEAKAGE_COLUMNS
    ]

    X = df[
        feature_columns
    ].copy()

    y = df[
        TARGET_COLUMN
    ].astype(int)

    return (
        X,
        y,
        feature_columns,
    )


# =========================================================
# METRICS
# =========================================================

def threshold_metrics(
    y_true,
    probabilities,
    threshold,
):

    predictions = (
        probabilities >= threshold
    ).astype(int)

    return {
        "threshold": float(threshold),

        "accuracy": float(
            accuracy_score(
                y_true,
                predictions,
            )
        ),

        "precision": float(
            precision_score(
                y_true,
                predictions,
                zero_division=0,
            )
        ),

        "recall": float(
            recall_score(
                y_true,
                predictions,
                zero_division=0,
            )
        ),

        "f1": float(
            f1_score(
                y_true,
                predictions,
                zero_division=0,
            )
        ),

        "f2": float(
            fbeta_score(
                y_true,
                predictions,
                beta=2,
                zero_division=0,
            )
        ),
    }


# =========================================================
# THRESHOLD SEARCH
# =========================================================

def select_threshold(
    y_validation,
    probabilities,
):

    print("\n===========================================")
    print("XGBOOST THRESHOLD TUNING")
    print("===========================================")

    results = []

    thresholds = np.arange(
        0.10,
        0.81,
        0.02,
    )

    for threshold in thresholds:

        metrics = threshold_metrics(
            y_validation,
            probabilities,
            threshold,
        )

        results.append(
            metrics
        )


    results_df = pd.DataFrame(
        results
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
            float_format=lambda x: f"{x:.4f}",
        )
    )


    # Highest validation F2
    best_index = (
        results_df["f2"]
        .idxmax()
    )

    best = (
        results_df.loc[
            best_index
        ]
    )


    threshold = float(
        best["threshold"]
    )


    print("\n-------------------------------------------")
    print("SELECTED XGBOOST THRESHOLD")
    print("-------------------------------------------")

    print(
        f"Threshold: {threshold:.2f}"
    )

    print(
        f"Precision: {best['precision']:.4f}"
    )

    print(
        f"Recall:    {best['recall']:.4f}"
    )

    print(
        f"F1:        {best['f1']:.4f}"
    )

    print(
        f"F2:        {best['f2']:.4f}"
    )


    return (
        threshold,
        results,
    )


# =========================================================
# EVALUATION
# =========================================================

def evaluate(
    model,
    X,
    y,
    name,
    threshold,
):

    probabilities = (
        model.predict_proba(X)[:, 1]
    )


    predictions = (
        probabilities >= threshold
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


    print("\n===========================================")
    print(f"{name.upper()} RESULTS")
    print("===========================================")

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

        "accuracy": float(
            accuracy
        ),

        "precision": float(
            precision
        ),

        "recall": float(
            recall
        ),

        "f1": float(
            f1
        ),

        "f2": float(
            f2
        ),

        "roc_auc": float(
            roc_auc
        ),

        "pr_auc": float(
            pr_auc
        ),

        "threshold": float(
            threshold
        ),

        "confusion_matrix":
            cm.tolist(),
    }


# =========================================================
# FEATURE IMPORTANCE
# =========================================================

def feature_importance(
    model,
    feature_columns,
):

    importance = pd.DataFrame({
        "feature":
            feature_columns,

        "importance":
            model.feature_importances_,
    })


    importance = (
        importance
        .sort_values(
            "importance",
            ascending=False,
        )
    )


    print("\n===========================================")
    print("TOP XGBOOST FEATURES")
    print("===========================================")


    print(
        importance
        .head(20)
        .to_string(
            index=False
        )
    )


    return importance


# =========================================================
# MAIN
# =========================================================

def main():

    df = load_dataset()


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


    (
        X_train,
        y_train,
        feature_columns,
    ) = prepare_xy(
        train_df
    )


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


    # =====================================================
    # CLASS IMBALANCE
    # =====================================================

    negatives = int(
        (y_train == 0).sum()
    )

    positives = int(
        (y_train == 1).sum()
    )


    scale_pos_weight = (
        negatives
        / positives
    )


    print("\n===========================================")
    print("TRAINING DISTRIBUTION")
    print("===========================================")

    print(
        f"Negative: {negatives:,}"
    )

    print(
        f"Positive: {positives:,}"
    )

    print(
        f"scale_pos_weight: "
        f"{scale_pos_weight:.3f}"
    )


    # =====================================================
    # MODEL
    # =====================================================

    print(
        "\nTraining XGBoost..."
    )


    model = XGBClassifier(

        n_estimators=600,

        learning_rate=0.04,

        max_depth=6,

        min_child_weight=5,

        subsample=0.85,

        colsample_bytree=0.85,

        gamma=0.1,

        reg_alpha=0.1,

        reg_lambda=2.0,

        scale_pos_weight=
            scale_pos_weight,

        objective=
            "binary:logistic",

        eval_metric=
            "logloss",

        tree_method=
            "hist",

        random_state=42,

        n_jobs=-1,
    )


    model.fit(
        X_train,
        y_train,
    )


    print(
        "XGBoost training complete."
    )


    # =====================================================
    # VALIDATION THRESHOLD
    # =====================================================

    validation_probabilities = (
        model.predict_proba(
            X_validation
        )[:, 1]
    )


    (
        best_threshold,
        threshold_results,
    ) = select_threshold(
        y_validation,
        validation_probabilities,
    )


    # =====================================================
    # VALIDATION
    # =====================================================

    validation_metrics = evaluate(
        model,
        X_validation,
        y_validation,
        "validation",
        best_threshold,
    )


    # =====================================================
    # TEST
    # =====================================================

    test_metrics = evaluate(
        model,
        X_test,
        y_test,
        "test",
        best_threshold,
    )


    # =====================================================
    # FEATURE IMPORTANCE
    # =====================================================

    importance = feature_importance(
        model,
        feature_columns,
    )


    # =====================================================
    # SAVE
    # =====================================================

    ARTIFACT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    joblib.dump(
        model,
        MODEL_FILE,
    )


    importance.to_csv(
        ARTIFACT_DIR
        / "xgboost_feature_importance.csv",
        index=False,
    )


    metadata = {

        "model_type":
            "XGBClassifier",

        "model_version":
            "glycovision-spike-xgb-v1",

        "prediction_horizon_minutes":
            60,

        "target":
            TARGET_COLUMN,

        "decision_threshold":
            best_threshold,

        "feature_columns":
            feature_columns,

        "train_patients":
            train_patients,

        "validation_patients":
            validation_patients,

        "test_patients":
            test_patients,

        "scale_pos_weight":
            scale_pos_weight,

        "validation_metrics":
            validation_metrics,

        "test_metrics":
            test_metrics,

        "threshold_search":
            threshold_results,

        "notes":
            (
                "Research prototype only. "
                "Patient-level holdout. "
                "Not for autonomous clinical decisions "
                "or insulin dosing."
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


    print("\n===========================================")
    print("XGBOOST MODEL SAVED")
    print("===========================================")

    print(
        MODEL_FILE
    )

    print(
        "\nSelected threshold:"
    )

    print(
        f"{best_threshold:.2f}"
    )


if __name__ == "__main__":
    main()