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
    / "nested_sparse_model_results.csv"
)


# =========================================================
# CONFIG
# =========================================================

TARGET_COLUMN = "spike_risk_label"

OUTER_SPLITS = 5
INNER_SPLITS = 4


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
# LOAD DATA
# =========================================================

def load_data():

    print(
        "\nLoading GlycoVision sparse feature dataset..."
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
            "Missing sparse features: "
            + ", ".join(missing)
        )


    print(
        "\nSparse features used:"
    )

    print(
        f"{len(SPARSE_FEATURES)} features"
    )


    for feature in SPARSE_FEATURES:

        print(
            f"  - {feature}"
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

    groups = (
        df[
            "patient_id"
        ]
    )

    return (
        X,
        y,
        groups,
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

        n_jobs=-1,

        random_state=42,

        verbose=0,
    )


# =========================================================
# THRESHOLD METRICS
# =========================================================

def threshold_metrics(
    y_true,
    probabilities,
    threshold,
):

    predictions = (
        probabilities
        >= threshold
    ).astype(int)


    return {

        "accuracy":
            accuracy_score(
                y_true,
                predictions,
            ),

        "precision":
            precision_score(
                y_true,
                predictions,
                zero_division=0,
            ),

        "recall":
            recall_score(
                y_true,
                predictions,
                zero_division=0,
            ),

        "f1":
            f1_score(
                y_true,
                predictions,
                zero_division=0,
            ),

        "f2":
            fbeta_score(
                y_true,
                predictions,
                beta=2,
                zero_division=0,
            ),
    }


# =========================================================
# INNER CV — SELECT THRESHOLD
# =========================================================

def select_inner_threshold(
    X_train,
    y_train,
    groups_train,
):

    print(
        "\nRunning inner patient-level CV "
        "for threshold selection..."
    )


    inner_cv = GroupKFold(
        n_splits=INNER_SPLITS
    )


    thresholds = np.arange(
        0.10,
        0.81,
        0.02,
    )


    scores = {

        float(threshold):
            []

        for threshold
        in thresholds
    }


    for (
        fold_number,
        (
            inner_train_idx,
            inner_val_idx,
        ),
    ) in enumerate(

        inner_cv.split(
            X_train,
            y_train,
            groups_train,
        ),

        start=1,
    ):

        X_inner_train = (
            X_train.iloc[
                inner_train_idx
            ]
        )

        y_inner_train = (
            y_train.iloc[
                inner_train_idx
            ]
        )


        X_inner_val = (
            X_train.iloc[
                inner_val_idx
            ]
        )

        y_inner_val = (
            y_train.iloc[
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


        for threshold in thresholds:

            metrics = (
                threshold_metrics(
                    y_inner_val,
                    probabilities,
                    threshold,
                )
            )


            scores[
                float(threshold)
            ].append(
                metrics[
                    "f2"
                ]
            )


        print(
            f"  Inner fold "
            f"{fold_number}/"
            f"{INNER_SPLITS} complete"
        )


    mean_scores = {

        threshold:
            float(
                np.mean(
                    fold_scores
                )
            )

        for (
            threshold,
            fold_scores,
        )
        in scores.items()
    }


    best_threshold = max(
        mean_scores,
        key=mean_scores.get,
    )


    print(
        f"\nSelected threshold "
        f"from inner CV: "
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
# OUTER EVALUATION
# =========================================================

def evaluate_outer(
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
        f"OUTER FOLD "
        f"{fold_number} RESULTS"
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

        "fold":
            fold_number,

        "threshold":
            threshold,

        "accuracy":
            accuracy,

        "precision":
            precision,

        "recall":
            recall,

        "f1":
            f1,

        "f2":
            f2,

        "roc_auc":
            roc_auc,

        "pr_auc":
            pr_auc,

        "tn":
            int(tn),

        "fp":
            int(fp),

        "fn":
            int(fn),

        "tp":
            int(tp),
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
        "NESTED SPARSE MODEL EVALUATION"
    )

    print(
        "==========================================="
    )


    print(
        "\nEach patient appears in the "
        "evaluation set of one outer fold."
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
            f"{outer_fold}/"
            f"{OUTER_SPLITS}"
        )

        print(
            "==========================================="
        )


        X_outer_train = (
            X.iloc[
                outer_train_idx
            ]
            .reset_index(
                drop=True
            )
        )


        y_outer_train = (
            y.iloc[
                outer_train_idx
            ]
            .reset_index(
                drop=True
            )
        )


        groups_outer_train = (
            groups.iloc[
                outer_train_idx
            ]
            .reset_index(
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
            f"Train rows: "
            f"{len(X_outer_train):,}"
        )

        print(
            f"Test rows: "
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
        # LEAKAGE CHECK
        # -------------------------------------------------

        overlap = (
            set(
                train_patients
            )
            &
            set(
                test_patients
            )
        )


        if overlap:

            raise RuntimeError(
                "Patient leakage detected: "
                f"{overlap}"
            )


        # -------------------------------------------------
        # INNER THRESHOLD SELECTION
        # -------------------------------------------------

        threshold = (
            select_inner_threshold(
                X_outer_train,
                y_outer_train,
                groups_outer_train,
            )
        )


        # -------------------------------------------------
        # TRAIN OUTER MODEL
        # -------------------------------------------------

        print(
            "\nTraining outer sparse model..."
        )


        model = create_model()


        model.fit(
            X_outer_train,
            y_outer_train,
        )


        print(
            "Outer sparse model "
            "training complete."
        )


        # -------------------------------------------------
        # TEST OUTER MODEL
        # -------------------------------------------------

        metrics = (
            evaluate_outer(
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


        results.append(
            metrics
        )


    # =====================================================
    # RESULTS TABLE
    # =====================================================

    results_df = (
        pd.DataFrame(
            results
        )
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
        "FINAL NESTED SPARSE MODEL RESULTS"
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


    # =====================================================
    # MEAN ± STD
    # =====================================================

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
    # THRESHOLDS
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


    print(
        "Median threshold:"
    )

    print(
        f"{results_df['threshold'].median():.3f}"
    )


    # =====================================================
    # AGGREGATED CONFUSION MATRIX
    # =====================================================

    tn = (
        results_df[
            "tn"
        ].sum()
    )

    fp = (
        results_df[
            "fp"
        ].sum()
    )

    fn = (
        results_df[
            "fn"
        ].sum()
    )

    tp = (
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
                    tn,
                    fp,
                ],
                [
                    fn,
                    tp,
                ],
            ]
        )
    )


    print(
        f"\nTN: {tn:,}"
    )

    print(
        f"FP: {fp:,}"
    )

    print(
        f"FN: {fn:,}"
    )

    print(
        f"TP: {tp:,}"
    )


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
        "\nNested sparse-model "
        "evaluation complete."
    )


if __name__ == "__main__":
    main()