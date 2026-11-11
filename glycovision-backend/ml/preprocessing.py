from pathlib import Path

import pandas as pd


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

RAW_DIR = (
    PROJECT_ROOT
    / "datasets"
    / "raw"
    / "hupa_ucm"
)

PROCESSED_DIR = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
)

OUTPUT_FILE = (
    PROCESSED_DIR
    / "hupa_ucm_clean.csv"
)


# =========================================================
# EXPECTED HUPA-UCM COLUMNS
# =========================================================

EXPECTED_COLUMNS = [
    "time",
    "glucose",
    "calories",
    "heart_rate",
    "steps",
    "basal_rate",
    "bolus_volume_delivered",
    "carb_input",
]


NUMERIC_COLUMNS = [
    "glucose",
    "calories",
    "heart_rate",
    "steps",
    "basal_rate",
    "bolus_volume_delivered",
    "carb_input",
]


# =========================================================
# LOAD ONE PATIENT
# =========================================================

def load_patient_csv(
    file_path: Path,
) -> pd.DataFrame:
    """
    Load and clean one HUPA-UCM participant CSV.

    HUPA-UCM uses semicolon-separated CSV files.
    """

    print(
        f"[Preprocessing] Loading {file_path.name}"
    )

    df = pd.read_csv(
        file_path,
        sep=";",
    )


    # -----------------------------------------------------
    # VALIDATE COLUMNS
    # -----------------------------------------------------

    missing_columns = [
        column
        for column in EXPECTED_COLUMNS
        if column not in df.columns
    ]

    if missing_columns:

        raise ValueError(
            f"{file_path.name} is missing columns: "
            f"{missing_columns}"
        )


    # -----------------------------------------------------
    # KEEP ONLY EXPECTED COLUMNS
    # -----------------------------------------------------

    df = df[
        EXPECTED_COLUMNS
    ].copy()


    # -----------------------------------------------------
    # PATIENT ID
    # -----------------------------------------------------

    # Example:
    #
    # HUPA0001P.csv
    #     ↓
    # HUPA0001P

    df["patient_id"] = (
        file_path.stem
    )


    # -----------------------------------------------------
    # TIME
    # -----------------------------------------------------

    df["time"] = pd.to_datetime(
        df["time"],
        errors="coerce",
    )


    # -----------------------------------------------------
    # NUMERIC CONVERSION
    # -----------------------------------------------------

    for column in NUMERIC_COLUMNS:

        df[column] = pd.to_numeric(
            df[column],
            errors="coerce",
        )


    # -----------------------------------------------------
    # REMOVE ROWS WITHOUT ESSENTIAL CGM INFORMATION
    # -----------------------------------------------------

    before = len(df)

    df = df.dropna(
        subset=[
            "time",
            "glucose",
        ]
    )

    removed = (
        before - len(df)
    )

    if removed:

        print(
            f"[Preprocessing] "
            f"{file_path.name}: "
            f"removed {removed} rows "
            f"with missing time/glucose"
        )


    # -----------------------------------------------------
    # REMOVE DUPLICATE TIMESTAMPS FOR SAME PATIENT
    # -----------------------------------------------------

    df = df.drop_duplicates(
        subset=[
            "patient_id",
            "time",
        ],
        keep="first",
    )


    # -----------------------------------------------------
    # SORT
    # -----------------------------------------------------

    df = df.sort_values(
        "time"
    ).reset_index(
        drop=True
    )


    return df


# =========================================================
# LOAD ALL PATIENTS
# =========================================================

def load_all_patients() -> pd.DataFrame:
    """
    Read every HUPA preprocessed participant CSV and
    combine them into a single dataframe.
    """

    if not RAW_DIR.exists():

        raise FileNotFoundError(
            f"HUPA dataset folder not found:\n{RAW_DIR}"
        )


    files = sorted(
        RAW_DIR.glob(
            "HUPA*.csv"
        )
    )


    if not files:

        raise FileNotFoundError(
            f"No HUPA CSV files found inside:\n{RAW_DIR}"
        )


    print(
        f"\nFound {len(files)} patient files."
    )


    patient_frames = []


    for file_path in files:

        patient_df = (
            load_patient_csv(
                file_path
            )
        )

        patient_frames.append(
            patient_df
        )


    combined = pd.concat(
        patient_frames,
        ignore_index=True,
    )


    combined = combined.sort_values(
        [
            "patient_id",
            "time",
        ]
    ).reset_index(
        drop=True
    )


    return combined


# =========================================================
# DATA QUALITY REPORT
# =========================================================

def print_data_report(
    df: pd.DataFrame,
) -> None:

    print(
        "\n"
        "==========================================="
    )

    print(
        "HUPA-UCM DATA QUALITY REPORT"
    )

    print(
        "==========================================="
    )


    print(
        f"Total rows: {len(df):,}"
    )


    print(
        f"Patients: {df['patient_id'].nunique()}"
    )


    print(
        "\nRows per patient:"
    )

    print(
        df.groupby(
            "patient_id"
        ).size()
    )


    print(
        "\nMissing values:"
    )

    print(
        df.isna().sum()
    )


    print(
        "\nGlucose statistics:"
    )

    print(
        df["glucose"].describe()
    )


    print(
        "\nTime range:"
    )

    print(
        "Start:",
        df["time"].min(),
    )

    print(
        "End:",
        df["time"].max(),
    )


    print(
        "\nFirst 5 processed rows:"
    )

    print(
        df.head().to_string()
    )


# =========================================================
# SAVE
# =========================================================

def save_processed_dataset(
    df: pd.DataFrame,
) -> None:

    PROCESSED_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


    df.to_csv(
        OUTPUT_FILE,
        index=False,
    )


    print(
        "\n"
        f"Processed dataset saved to:\n"
        f"{OUTPUT_FILE}"
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print(
        "\nStarting HUPA-UCM preprocessing...\n"
    )


    df = (
        load_all_patients()
    )


    print_data_report(
        df
    )


    save_processed_dataset(
        df
    )


    print(
        "\nPreprocessing complete."
    )


if __name__ == "__main__":
    main()