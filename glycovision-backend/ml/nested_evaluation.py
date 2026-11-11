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
    / "nested_evaluation_results.csv"
)


# =========================================================
# CONFIG
# =========================================================

TARGET_COLUMN = "spike_risk_label"

OUTER_SPLITS = 5
INNER_SPLITS = 4


EXCLUDED_COLUMNS = [
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

def load_data():

    print(
        "\nLoading GlycoVision feature dataset..."
    )

    df = pd.read_csv(
        DATASET_PATH
    )

    print(
        f"Rows: {len(df):,}"
    )

    print(
        f"Patients: "
        f"{df['patient_id'].nunique()}"
    )

    return df


# =========================================================
# PREPARE DATA
# =========================================================

def prepare_data(df):

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

    groups = df[
        "patient_id"
    ]

    return (
        X,
        y,
        groups,
        feature_columns,
    )


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
        random_state=42,
        n_jobs=-1,
        verbose=0,
    )


# =========================================================
# THRESHOLD METRICS
# =========================================================

def get_threshold_metrics(
    y_true,
    probabilities,
    threshold,
):

    predictions = (
        probabilities
        >= threshold
    ).astype(int)

    return {
        "threshold": float(
            threshold
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
# INNER CV THRESHOLD SELECTION
# =========================================================

def choose_threshold_inner_cv(
    X_outer_train,
    y_outer_train,
    groups_outer_train,
):

    print(
        "\nRunning inner CV for threshold selection..."
    )

    inner_cv = GroupKFold(
        n_splits=INNER_SPLITS
    )

    threshold_grid = np.arange(
        0.10,
        0.81,
        0.02,
    )

    threshold_scores = {
        float(threshold): []
        for threshold in threshold_grid
    }


    for (
        inner_fold,
        (
            inner_train_idx,
            inner_val_idx,
        ),
    ) in enumerate(
        inner_cv.split(
            X_outer_train,
            y_outer_train,
            groups_outer_train,
        ),
        start=1,
    ):

        X_inner_train = (
            X_outer_train.iloc[
                inner_train_idx
            ]
        )

        y_inner_train = (
            y_outer_train.iloc[
                inner_train_idx
            ]
        )

        X_inner_val = (
            X_outer_train.iloc[
                inner_val_idx
            ]
        )

        y_inner_val = (
            y_outer_train.iloc[
                inner_val_idx
            ]
        )


        model = create_model()

        model.fit(
            X_inner_train,
            y_inner_train,
        )


        probabilities = (
            model.predict_proba(
                X_inner_val
            )[:, 1]
        )


        for threshold in threshold_grid:

            metrics = (
                get_threshold_metrics(
                    y_inner_val,
                    probabilities,
                    threshold,
                )
            )

            threshold_scores[
                float(threshold)
            ].append(
                metrics["f2"]
            )


        print(
            f"  Inner fold "
            f"{inner_fold}/{INNER_SPLITS} complete"
        )


    # Average F2 across inner folds
    mean_scores = {
        threshold:
            float(
                np.mean(
                    scores
                )
            )

        for threshold, scores
        in threshold_scores.items()
    }


    best_threshold = max(
        mean_scores,
        key=mean_scores.get,
    )


    print(
        f"Selected threshold from inner CV: "
        f"{best_threshold:.2f}"
    )

    print(
        f"Mean inner F2: "
        f"{mean_scores[best_threshold]:.4f}"
    )


    return float(
        best_threshold
    )


# =========================================================
# OUTER FOLD EVALUATION
# =========================================================

def evaluate_outer_fold(
    fold_number,
    model,
    X_test,
    y_test,
    threshold,
):

    probabilities = (
        model.predict_proba(
            X_test
        )[:, 1]
    )

    predictions = (
        probabilities
        >= threshold
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

    tn, fp, fn, tp = (
        cm.ravel()
    )


    print(
        "\n-------------------------------------------"
    )

    print(
        f"OUTER FOLD {fold_number} RESULTS"
    )

    print(
        "-------------------------------------------"
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
        f"F1:        {f1:.4f}"
    )

    print(
        f"F2:        {f2:.4f}"
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


    return {
        "fold": fold_number,
        "threshold": float(
            threshold
        ),
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
        "tn": int(
            tn
        ),
        "fp": int(
            fp
        ),
        "fn": int(
            fn
        ),
        "tp": int(
            tp
        ),
    }


# =========================================================
# MAIN
# =========================================================

def main():

    df = load_data()

    (
        X,
        y,
        groups,
        feature_columns,
    ) = prepare_data(
        df
    )


    outer_cv = GroupKFold(
        n_splits=OUTER_SPLITS
    )


    results = []


    print(
        "\n==========================================="
    )

    print(
        "NESTED PATIENT-LEVEL EVALUATION"
    )

    print(
        "==========================================="
    )


    for (
        outer_fold,
        (
            outer_train_idx,
            outer_test_idx,
        ),
    ) in enumerate(
        outer_cv.split(
            X,
            y,
            groups,
        ),
        start=1,
    ):

        print(
            "\n==========================================="
        )

        print(
            f"OUTER FOLD "
            f"{outer_fold}/{OUTER_SPLITS}"
        )

        print(
            "==========================================="
        )


        X_outer_train = (
            X.iloc[
                outer_train_idx
            ].reset_index(
                drop=True
            )
        )

        y_outer_train = (
            y.iloc[
                outer_train_idx
            ].reset_index(
                drop=True
            )
        )

        groups_outer_train = (
            groups.iloc[
                outer_train_idx
            ].reset_index(
                drop=True
            )
        )


        X_outer_test = (
            X.iloc[
                outer_test_idx
            ]
        )

        y_outer_test = (
            y.iloc[
                outer_test_idx
            ]
        )

        groups_outer_test = (
            groups.iloc[
                outer_test_idx
            ]
        )


        train_patients = sorted(
            groups_outer_train.unique()
        )

        test_patients = sorted(
            groups_outer_test.unique()
        )


        print(
            f"Outer train rows: "
            f"{len(X_outer_train):,}"
        )

        print(
            f"Outer test rows: "
            f"{len(X_outer_test):,}"
        )

        print(
            f"Train patients: "
            f"{len(train_patients)}"
        )

        print(
            f"Test patients: "
            f"{len(test_patients)}"
        )


        print(
            "\nHeld-out patients:"
        )

        for patient in test_patients:
            print(
                f"  - {patient}"
            )


        # -------------------------------------------------
        # SAFETY CHECK
        # -------------------------------------------------

        overlap = set(
            train_patients
        ).intersection(
            test_patients
        )

        if overlap:

            raise RuntimeError(
                f"Patient leakage detected: "
                f"{overlap}"
            )


        # -------------------------------------------------
        # INNER CV — SELECT THRESHOLD
        # -------------------------------------------------

        threshold = (
            choose_threshold_inner_cv(
                X_outer_train,
                y_outer_train,
                groups_outer_train,
            )
        )


        # -------------------------------------------------
        # TRAIN FINAL MODEL FOR THIS OUTER FOLD
        # -------------------------------------------------

        print(
            "\nTraining outer-fold model..."
        )

        model = create_model()

        model.fit(
            X_outer_train,
            y_outer_train,
        )

        print(
            "Outer-fold training complete."
        )


        # -------------------------------------------------
        # EVALUATE HELD-OUT OUTER PATIENTS
        # -------------------------------------------------

        metrics = (
            evaluate_outer_fold(
                outer_fold,
                model,
                X_outer_test,
                y_outer_test,
                threshold,
            )
        )


        metrics[
            "test_patients"
        ] = ",".join(
            test_patients
        )

        metrics[
            "test_rows"
        ] = len(
            X_outer_test
        )


        results.append(
            metrics
        )


    # =====================================================
    # SUMMARY
    # =====================================================

    results_df = pd.DataFrame(
        results
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


    print(
        "\n\n==========================================="
    )

    print(
        "FINAL NESTED EVALUATION RESULTS"
    )

    print(
        "==========================================="
    )


    print(
        results_df[
            [
                "fold",
                "threshold",
                *metric_columns,
            ]
        ].to_string(
            index=False,
            float_format=lambda x:
                f"{x:.4f}",
        )
    )


    print(
        "\n==========================================="
    )

    print(
        "MEAN ± STANDARD DEVIATION"
    )

    print(
        "==========================================="
    )


    for metric in metric_columns:

        mean = (
            results_df[
                metric
            ].mean()
        )

        std = (
            results_df[
                metric
            ].std()
        )

        print(
            f"{metric.upper():10s}: "
            f"{mean:.4f} ± {std:.4f}"
        )


    # =====================================================
    # THRESHOLD STABILITY
    # =====================================================

    print(
        "\n==========================================="
    )

    print(
        "SELECTED THRESHOLDS"
    )

    print(
        "==========================================="
    )


    print(
        results_df[
            [
                "fold",
                "threshold",
            ]
        ].to_string(
            index=False
        )
    )


    print(
        "\nMean threshold:"
    )

    print(
        f"{results_df['threshold'].mean():.3f}"
    )


    # =====================================================
    # AGGREGATED CONFUSION MATRIX
    # =====================================================

    total_tn = (
        results_df[
            "tn"
        ].sum()
    )

    total_fp = (
        results_df[
            "fp"
        ].sum()
    )

    total_fn = (
        results_df[
            "fn"
        ].sum()
    )

    total_tp = (
        results_df[
            "tp"
        ].sum()
    )


    print(
        "\n==========================================="
    )

    print(
        "AGGREGATED CONFUSION MATRIX"
    )

    print(
        "==========================================="
    )


    print(
        np.array(
            [
                [
                    total_tn,
                    total_fp,
                ],
                [
                    total_fn,
                    total_tp,
                ],
            ]
        )
    )


    print(
        f"\nTN: {total_tn:,}"
    )

    print(
        f"FP: {total_fp:,}"
    )

    print(
        f"FN: {total_fn:,}"
    )

    print(
        f"TP: {total_tp:,}"
    )


    # =====================================================
    # SAVE
    # =====================================================

    RESULTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    results_df.to_csv(
        RESULTS_FILE,
        index=False,
    )


    print(
        "\n==========================================="
    )

    print(
        "RESULTS SAVED"
    )

    print(
        "==========================================="
    )


    print(
        RESULTS_FILE
    )


    print(
        "\nNested evaluation complete."
    )


if __name__ == "__main__":
    main()