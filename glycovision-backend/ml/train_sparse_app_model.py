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


PROJECT_ROOT = Path(__file__).resolve().parent.parent

FEATURE_FILE = (
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
    / "glycovision_spike_sparse.joblib"
)

METADATA_FILE = (
    MODEL_DIR
    / "glycovision_spike_sparse_metadata.json"
)

TARGET_COLUMN = "spike_risk_label"


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


def load_dataset():

    print("\nLoading GlycoVision sparse-model dataset...")

    df = pd.read_csv(
        FEATURE_FILE
    )

    print(
        f"Rows: {len(df):,}"
    )

    print(
        f"Patients: {df['patient_id'].nunique()}"
    )

    missing = [
        feature
        for feature in SPARSE_FEATURES
        if feature not in df.columns
    ]

    if missing:
        raise ValueError(
            "Missing sparse features: "
            + ", ".join(missing)
        )

    return df


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


def prepare_xy(df):

    X = df[
        SPARSE_FEATURES
    ].copy()

    y = (
        df[
            TARGET_COLUMN
        ]
        .astype(int)
    )

    return X, y


def metrics_at_threshold(
    y_true,
    probabilities,
    threshold,
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


def select_threshold(
    y_validation,
    probabilities,
):

    print("\n===========================================")
    print("SPARSE MODEL THRESHOLD TUNING")
    print("===========================================")

    thresholds = np.arange(
        0.10,
        0.81,
        0.02,
    )

    results = []

    for threshold in thresholds:

        result = metrics_at_threshold(
            y_validation,
            probabilities,
            threshold,
        )

        results.append(
            result
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
            float_format=lambda x:
                f"{x:.4f}",
        )
    )

    best_index = (
        results_df["f2"]
        .idxmax()
    )

    best = (
        results_df.loc[
            best_index
        ]
    )

    best_threshold = float(
        best["threshold"]
    )

    print("\n-------------------------------------------")
    print("SELECTED SPARSE THRESHOLD")
    print("-------------------------------------------")

    print(
        f"Threshold: {best_threshold:.2f}"
    )

    print(
        f"Precision: {best['precision']:.4f}"
    )

    print(
        f"Recall: {best['recall']:.4f}"
    )

    print(
        f"F1: {best['f1']:.4f}"
    )

    print(
        f"F2: {best['f2']:.4f}"
    )

    return (
        best_threshold,
        results,
    )


def evaluate(
    model,
    X,
    y,
    split_name,
    threshold,
):

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

    print("\n===========================================")
    print(
        f"{split_name.upper()} RESULTS"
    )
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

        "threshold":
            float(threshold),

        "confusion_matrix":
            cm.tolist(),
    }


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

    X_train, y_train = (
        prepare_xy(
            train_df
        )
    )

    X_validation, y_validation = (
        prepare_xy(
            validation_df
        )
    )

    X_test, y_test = (
        prepare_xy(
            test_df
        )
    )

    print("\n===========================================")
    print("TRAIN TARGET DISTRIBUTION")
    print("===========================================")

    print(
        y_train.value_counts()
    )

    print(
        "\nPositive rate:"
    )

    print(
        f"{y_train.mean() * 100:.2f}%"
    )


    print(
        "\nTraining sparse/manual-BG Random Forest..."
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


    validation_metrics = evaluate(
        model,
        X_validation,
        y_validation,
        "validation",
        best_threshold,
    )


    test_metrics = evaluate(
        model,
        X_test,
        y_test,
        "test",
        best_threshold,
    )


    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    joblib.dump(
        model,
        MODEL_FILE,
    )


    metadata = {

        "model_name":
            "GlycoVision Sparse BG Spike Predictor",

        "model_version":
            "glycovision-spike-sparse-rf-v1",

        "model_type":
            "RandomForestClassifier",

        "prediction_horizon_minutes":
            60,

        "decision_threshold":
            best_threshold,

        "target":
            TARGET_COLUMN,

        "feature_count":
            len(
                SPARSE_FEATURES
            ),

        "feature_columns":
            SPARSE_FEATURES,

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

        "dataset":
            "HUPA-UCM Diabetes Dataset",

        "purpose":
            (
                "Research model intended for sparse/manual "
                "blood-glucose history using 15, 30 and "
                "60-minute glucose anchors."
            ),

        "limitations": [
            (
                "Manual readings may not perfectly match "
                "the timing characteristics of CGM data."
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


    print("\n===========================================")
    print("SPARSE MODEL SAVED")
    print("===========================================")

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
        "\nSelected threshold:"
    )

    print(
        f"{best_threshold:.2f}"
    )


if __name__ == "__main__":
    main()