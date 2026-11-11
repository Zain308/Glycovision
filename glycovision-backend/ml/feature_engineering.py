from pathlib import Path

import numpy as np
import pandas as pd


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

INPUT_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_clean.csv"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_features.csv"
)


# =========================================================
# CONFIG
# =========================================================

SAMPLE_MINUTES = 5

HISTORY_MINUTES = 60

PREDICT_30_MINUTES = 30
PREDICT_60_MINUTES = 60

HISTORY_STEPS = (
    HISTORY_MINUTES // SAMPLE_MINUTES
)

TARGET_30_STEPS = (
    PREDICT_30_MINUTES // SAMPLE_MINUTES
)

TARGET_60_STEPS = (
    PREDICT_60_MINUTES // SAMPLE_MINUTES
)


# We allow only nearly regular CGM windows.
MAX_GAP_MINUTES = 7.5


# =========================================================
# CONTINUITY CHECK
# =========================================================

def is_continuous_window(
    times: pd.Series,
) -> bool:
    """
    Check that consecutive records inside a window are
    approximately 5 minutes apart.

    This prevents us from accidentally treating a large
    missing-data gap as a normal time-series sequence.
    """

    diffs = (
        times
        .diff()
        .dropna()
        .dt.total_seconds()
        / 60
    )

    if diffs.empty:
        return False

    return bool(
        (diffs <= MAX_GAP_MINUTES).all()
        and
        (diffs > 0).all()
    )


# =========================================================
# BUILD FEATURES FOR ONE PATIENT
# =========================================================

def build_patient_features(
    patient_df: pd.DataFrame,
) -> list[dict]:

    patient_df = (
        patient_df
        .sort_values("time")
        .reset_index(drop=True)
        .copy()
    )


    samples = []


    # -----------------------------------------------------
    # Number of points required after current time
    # -----------------------------------------------------

    max_future_steps = (
        TARGET_60_STEPS
    )


    start_index = (
        HISTORY_STEPS
    )


    end_index = (
        len(patient_df)
        - max_future_steps
    )


    for current_idx in range(
        start_index,
        end_index,
    ):

        # -------------------------------------------------
        # HISTORY WINDOW
        # -------------------------------------------------

        history_start = (
            current_idx
            - HISTORY_STEPS
        )


        history = (
            patient_df.iloc[
                history_start:
                current_idx + 1
            ]
        )


        # -------------------------------------------------
        # FUTURE WINDOW
        # -------------------------------------------------

        future = (
            patient_df.iloc[
                current_idx:
                current_idx
                + TARGET_60_STEPS
                + 1
            ]
        )


        # -------------------------------------------------
        # ENSURE TEMPORAL CONTINUITY
        # -------------------------------------------------

        if not is_continuous_window(
            history["time"]
        ):

            continue


        if not is_continuous_window(
            future["time"]
        ):

            continue


        current_row = (
            patient_df.iloc[
                current_idx
            ]
        )


        current_bg = float(
            current_row["glucose"]
        )


        # -------------------------------------------------
        # GLUCOSE HISTORY
        # -------------------------------------------------

        glucose_values = (
            history["glucose"]
            .astype(float)
            .tolist()
        )


        # Should contain:
        #
        # t-60, t-55, ..., t-5, t
        #
        if len(glucose_values) != 13:

            continue


        sample = {

            "patient_id":
                current_row["patient_id"],

            "sample_time":
                current_row["time"],

        }


        # -------------------------------------------------
        # STORE GLUCOSE LAGS
        # -------------------------------------------------

        minutes_back = (
            HISTORY_MINUTES
        )


        for glucose_value in glucose_values:

            sample[
                f"glucose_t_minus_{minutes_back}"
            ] = float(
                glucose_value
            )

            minutes_back -= (
                SAMPLE_MINUTES
            )


        # Rename current point for readability
        sample["current_bg"] = (
            sample.pop(
                "glucose_t_minus_0"
            )
        )


        # -------------------------------------------------
        # GLUCOSE TREND FEATURES
        # -------------------------------------------------

        sample["bg_change_15m"] = (
            current_bg
            - float(
                patient_df.iloc[
                    current_idx - 3
                ]["glucose"]
            )
        )


        sample["bg_change_30m"] = (
            current_bg
            - float(
                patient_df.iloc[
                    current_idx - 6
                ]["glucose"]
            )
        )


        sample["bg_change_60m"] = (
            current_bg
            - float(
                patient_df.iloc[
                    current_idx - 12
                ]["glucose"]
            )
        )


        sample["bg_mean_60m"] = float(
            history[
                "glucose"
            ].mean()
        )


        sample["bg_std_60m"] = float(
            history[
                "glucose"
            ].std()
        )


        sample["bg_min_60m"] = float(
            history[
                "glucose"
            ].min()
        )


        sample["bg_max_60m"] = float(
            history[
                "glucose"
            ].max()
        )


        # -------------------------------------------------
        # MEAL / INSULIN CONTEXT
        # -------------------------------------------------

        sample["carbs_60m"] = float(
            history[
                "carb_input"
            ].sum()
        )


        sample["bolus_60m"] = float(
            history[
                "bolus_volume_delivered"
            ].sum()
        )


        sample["basal_mean_60m"] = float(
            history[
                "basal_rate"
            ].mean()
        )


        # -------------------------------------------------
        # ACTIVITY / PHYSIOLOGY
        # -------------------------------------------------

        sample["heart_rate_mean_60m"] = float(
            history[
                "heart_rate"
            ].mean()
        )


        sample["steps_60m"] = float(
            history[
                "steps"
            ].sum()
        )


        sample["calories_60m"] = float(
            history[
                "calories"
            ].sum()
        )


        # -------------------------------------------------
        # TIME FEATURES
        # -------------------------------------------------

        hour = (
            current_row["time"].hour
            +
            current_row["time"].minute / 60
        )


        sample["hour_sin"] = float(
            np.sin(
                2
                * np.pi
                * hour
                / 24
            )
        )


        sample["hour_cos"] = float(
            np.cos(
                2
                * np.pi
                * hour
                / 24
            )
        )


        # -------------------------------------------------
        # FUTURE TARGETS
        # -------------------------------------------------

        target_30_idx = (
            current_idx
            + TARGET_30_STEPS
        )


        target_60_idx = (
            current_idx
            + TARGET_60_STEPS
        )


        target_bg_30 = float(
            patient_df.iloc[
                target_30_idx
            ]["glucose"]
        )


        target_bg_60 = float(
            patient_df.iloc[
                target_60_idx
            ]["glucose"]
        )


        future_60_values = (
            patient_df.iloc[
                current_idx + 1:
                target_60_idx + 1
            ]["glucose"]
            .astype(float)
        )


        future_peak_60 = float(
            future_60_values.max()
        )


        sample[
            "target_bg_30m"
        ] = target_bg_30


        sample[
            "target_bg_60m"
        ] = target_bg_60


        sample[
            "future_peak_60m"
        ] = future_peak_60


        # -------------------------------------------------
        # SPIKE / HYPERGLYCEMIA LABELS
        # -------------------------------------------------

        bg_rise_60m = (
            future_peak_60
            - current_bg
        )

        # A genuine glucose rise/spike:
        # future glucose rises at least 40 mg/dL
        spike_label = int(
            bg_rise_60m >= 40
        )

        # Hyperglycemia crossing:
        # patient starts below 180 and crosses 180
        # during the next 60 minutes.
        hyperglycemia_crossing = int(
            current_bg < 180
            and future_peak_60 >= 180
        )

        # Main GlycoVision warning target:
        # either a meaningful rapid rise OR
        # an upcoming crossing into >180 mg/dL.
        spike_risk_label = int(
            spike_label == 1
            or hyperglycemia_crossing == 1
        )

        sample["bg_rise_60m"] = float(
            bg_rise_60m
        )

        sample["spike_label"] = (
            spike_label
        )

        sample["hyperglycemia_crossing"] = (
            hyperglycemia_crossing
        )

        sample["spike_risk_label"] = (
            spike_risk_label
        )


        samples.append(
            sample
        )


    return samples


# =========================================================
# BUILD ALL PATIENTS
# =========================================================

def build_all_features():

    print(
        "\nLoading cleaned HUPA-UCM dataset..."
    )


    df = pd.read_csv(
        INPUT_FILE
    )


    df["time"] = pd.to_datetime(
        df["time"],
        errors="coerce",
    )


    df = df.dropna(
        subset=[
            "time",
            "glucose",
            "patient_id",
        ]
    )


    patient_ids = sorted(
        df[
            "patient_id"
        ].unique()
    )


    print(
        f"Patients found: {len(patient_ids)}"
    )


    all_samples = []


    for patient_id in patient_ids:

        patient_df = (
            df[
                df["patient_id"]
                == patient_id
            ]
            .copy()
        )


        print(
            f"Building features for "
            f"{patient_id} "
            f"({len(patient_df):,} rows)..."
        )


        samples = (
            build_patient_features(
                patient_df
            )
        )


        print(
            f"  -> {len(samples):,} samples"
        )


        all_samples.extend(
            samples
        )


    features_df = (
        pd.DataFrame(
            all_samples
        )
    )


    return features_df


# =========================================================
# REPORT
# =========================================================

def print_feature_report(
    df: pd.DataFrame,
):

    print(
        "\n"
        "==========================================="
    )

    print(
        "GLYCOVISION FEATURE DATASET REPORT"
    )

    print(
        "==========================================="
    )


    print(
        f"Samples: {len(df):,}"
    )


    print(
        f"Patients: "
        f"{df['patient_id'].nunique()}"
    )


    print(
        f"Columns: {len(df.columns)}"
    )


    print(
        "\nSpike distribution:"
    )


    distribution = (
        df[
            "spike_label"
        ]
        .value_counts(
            normalize=False
        )
        .sort_index()
    )


    print(
        distribution
    )


    print(
        "\nSpike percentage:"
    )


    spike_pct = (
        df[
            "spike_label"
        ].mean()
        * 100
    )


    print(
        f"{spike_pct:.2f}%"
    )


    print(
        "\nTarget BG statistics:"
    )


    print(
        df[
            [
                "target_bg_30m",
                "target_bg_60m",
                "future_peak_60m",
            ]
        ].describe()
    )


    print(
        "\nFirst sample:"
    )


    print(
        df.head(
            1
        ).T
    )


# =========================================================
# SAVE
# =========================================================

def save_features(
    df: pd.DataFrame,
):

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )


    df.to_csv(
        OUTPUT_FILE,
        index=False,
    )


    print(
        "\nFeature dataset saved to:"
    )

    print(
        OUTPUT_FILE
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print(
        "\nStarting GlycoVision feature engineering...\n"
    )


    features_df = (
        build_all_features()
    )


    if features_df.empty:

        raise RuntimeError(
            "No valid feature samples were generated."
        )


    print_feature_report(
        features_df
    )


    save_features(
        features_df
    )


    print(
        "\nFeature engineering complete."
    )


if __name__ == "__main__":
    main()