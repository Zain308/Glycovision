from pathlib import Path

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    fbeta_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
)


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATASET_PATH = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_features.csv"
)

RESULTS_DIR = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
)

RESULTS_FILE = (
    RESULTS_DIR
    / "cross_validation_results.csv"
)


# =========================================================
# CONFIGURATION
# =========================================================

TARGET_COLUMN = "spike_risk_label"

N_SPLITS = 5

# Use the threshold selected previously on the RF validation set.
# We are NOT tuning it again on CV test folds.
DECISION_THRESHOLD = 0.28


# =========================================================
# COLUMNS THAT MUST NOT ENTER THE MODEL
# =========================================================

EXCLUDED_COLUMNS = [
    "patient_id",
    "sample_time",

    # Future information
    "target_bg_30m",
    "target_bg_60m",
    "future_peak_60m",
    "bg_rise_60m",

    # Labels / derived targets
    "spike_label",
    "hyperglycemia_crossing",
    "spike_risk_label",
]


# =========================================================
# LOAD DATA
# =========================================================

def load_data():

    print("\nLoading GlycoVision feature dataset...")

    df = pd.read_csv(DATASET_PATH)

    print(f"Rows: {len(df):,}")
    print(f"Patients: {df['patient_id'].nunique()}")
    print(f"Columns: {len(df.columns)}")

    return df


# =========================================================
# PREPARE FEATURES
# =========================================================

def prepare_data(df):

    feature_columns = [
        column
        for column in df.columns
        if column not in EXCLUDED_COLUMNS
    ]

    X = df[feature_columns].copy()

    y = df[TARGET_COLUMN].astype(int)

    groups = df["patient_id"]

    print("\nFeatures used:")
    print(f"{len(feature_columns)} features")

    for feature in feature_columns:
        print(f"  - {feature}")

    return X, y, groups, feature_columns


# =========================================================
# MODEL FACTORY
# =========================================================

def create_model():

    return RandomForestClassifier(
        n_estimators=300,
        max_depth=None,
        min_samples_split=2,
        min_samples_leaf=1,
        max_features="sqrt",
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
        verbose=0,
    )


# =========================================================
# EVALUATE ONE FOLD
# =========================================================

def evaluate_fold(
    fold_number,
    model,
    X_test,
    y_test,
):

    probabilities = model.predict_proba(X_test)[:, 1]

    predictions = (
        probabilities >= DECISION_THRESHOLD
    ).astype(int)

    accuracy = accuracy_score(
        y_test,
        predictions,
    )

    precision = precision_score(
        y_test,
        predictions,
        zero_division=0,
    )

    recall = recall_score(
        y_test,
        predictions,
        zero_division=0,
    )

    f1 = f1_score(
        y_test,
        predictions,
        zero_division=0,
    )

    f2 = fbeta_score(
        y_test,
        predictions,
        beta=2,
        zero_division=0,
    )

    roc_auc = roc_auc_score(
        y_test,
        probabilities,
    )

    pr_auc = average_precision_score(
        y_test,
        probabilities,
    )

    cm = confusion_matrix(
        y_test,
        predictions,
    )

    tn, fp, fn, tp = cm.ravel()

    print("\n-------------------------------------------")
    print(f"FOLD {fold_number} RESULTS")
    print("-------------------------------------------")

    print(f"Threshold: {DECISION_THRESHOLD:.2f}")

    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1:        {f1:.4f}")
    print(f"F2:        {f2:.4f}")
    print(f"ROC-AUC:   {roc_auc:.4f}")
    print(f"PR-AUC:    {pr_auc:.4f}")

    print("\nConfusion Matrix:")
    print(cm)

    return {
        "fold": fold_number,
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "f2": f2,
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }


# =========================================================
# MAIN CROSS-VALIDATION
# =========================================================

def main():

    df = load_data()

    X, y, groups, feature_columns = prepare_data(df)

    group_kfold = GroupKFold(
        n_splits=N_SPLITS
    )

    fold_results = []

    print("\n===========================================")
    print("PATIENT-LEVEL 5-FOLD CROSS-VALIDATION")
    print("===========================================")

    print(
        f"Decision threshold: "
        f"{DECISION_THRESHOLD:.2f}"
    )

    print(
        "\nEach patient appears in the evaluation "
        "set of exactly one fold."
    )

    # =====================================================
    # RUN FOLDS
    # =====================================================

    for fold_number, (
        train_index,
        test_index,
    ) in enumerate(
        group_kfold.split(
            X,
            y,
            groups,
        ),
        start=1,
    ):

        X_train = X.iloc[train_index]
        X_test = X.iloc[test_index]

        y_train = y.iloc[train_index]
        y_test = y.iloc[test_index]

        train_groups = groups.iloc[train_index]
        test_groups = groups.iloc[test_index]

        train_patients = sorted(
            train_groups.unique()
        )

        test_patients = sorted(
            test_groups.unique()
        )

        print("\n===========================================")
        print(f"FOLD {fold_number}/{N_SPLITS}")
        print("===========================================")

        print(
            f"Train rows: {len(X_train):,}"
        )

        print(
            f"Test rows:  {len(X_test):,}"
        )

        print(
            f"Train patients: {len(train_patients)}"
        )

        print(
            f"Test patients:  {len(test_patients)}"
        )

        print("\nHeld-out patients:")

        for patient in test_patients:
            print(f"  - {patient}")

        print("\nTraining target distribution:")

        print(
            y_train.value_counts()
        )

        positive_rate = (
            y_train.mean() * 100
        )

        print(
            f"Positive rate: "
            f"{positive_rate:.2f}%"
        )

        # Safety check: no patient leakage
        overlap = set(
            train_patients
        ).intersection(
            test_patients
        )

        if overlap:
            raise RuntimeError(
                f"Patient leakage detected: {overlap}"
            )

        # =================================================
        # TRAIN MODEL
        # =================================================

        print(
            "\nTraining Random Forest..."
        )

        model = create_model()

        model.fit(
            X_train,
            y_train,
        )

        print(
            "Training complete."
        )

        # =================================================
        # EVALUATE
        # =================================================

        metrics = evaluate_fold(
            fold_number,
            model,
            X_test,
            y_test,
        )

        metrics[
            "test_patients"
        ] = ",".join(
            test_patients
        )

        metrics[
            "test_rows"
        ] = len(
            X_test
        )

        fold_results.append(
            metrics
        )

    # =====================================================
    # SUMMARY
    # =====================================================

    results_df = pd.DataFrame(
        fold_results
    )

    metric_columns = [
        "accuracy",
        "precision",
        "recall",
        "f1",
        "f2",
        "roc_auc",
        "pr_auc",
    ]

    print("\n\n===========================================")
    print("FINAL CROSS-VALIDATION RESULTS")
    print("===========================================")

    print(
        results_df[
            [
                "fold",
                *metric_columns,
            ]
        ].to_string(
            index=False,
            float_format=lambda x: f"{x:.4f}",
        )
    )

    print("\n===========================================")
    print("MEAN ± STANDARD DEVIATION")
    print("===========================================")

    summary = {}

    for metric in metric_columns:

        mean = results_df[
            metric
        ].mean()

        std = results_df[
            metric
        ].std()

        summary[
            metric
        ] = {
            "mean": mean,
            "std": std,
        }

        print(
            f"{metric.upper():10s}: "
            f"{mean:.4f} ± {std:.4f}"
        )

    # =====================================================
    # AGGREGATED CONFUSION MATRIX
    # =====================================================

    total_tn = results_df["tn"].sum()
    total_fp = results_df["fp"].sum()
    total_fn = results_df["fn"].sum()
    total_tp = results_df["tp"].sum()

    print("\n===========================================")
    print("AGGREGATED CONFUSION MATRIX")
    print("===========================================")

    print(
        np.array(
            [
                [total_tn, total_fp],
                [total_fn, total_tp],
            ]
        )
    )

    print("\nTotal:")
    print(f"TN: {total_tn:,}")
    print(f"FP: {total_fp:,}")
    print(f"FN: {total_fn:,}")
    print(f"TP: {total_tp:,}")

    # =====================================================
    # SAVE RESULTS
    # =====================================================

    RESULTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    results_df.to_csv(
        RESULTS_FILE,
        index=False,
    )

    print("\n===========================================")
    print("RESULTS SAVED")
    print("===========================================")

    print(
        RESULTS_FILE
    )

    print("\nCross-validation complete.")


if __name__ == "__main__":
    main()