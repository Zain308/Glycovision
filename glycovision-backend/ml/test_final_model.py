from pathlib import Path
import json

import joblib
import pandas as pd


# =========================================================
# PATHS
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_FILE = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
    / "glycovision_spike_final.joblib"
)

METADATA_FILE = (
    PROJECT_ROOT
    / "models"
    / "spike_prediction"
    / "glycovision_spike_final_metadata.json"
)

FEATURE_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "processed"
    / "hupa_ucm_features.csv"
)


# =========================================================
# LOAD MODEL
# =========================================================

print("\nLoading GlycoVision spike model...")

model = joblib.load(
    MODEL_FILE
)


# =========================================================
# LOAD METADATA
# =========================================================

with open(
    METADATA_FILE,
    "r",
    encoding="utf-8",
) as file:
    metadata = json.load(
        file
    )


feature_columns = metadata[
    "feature_columns"
]

threshold = float(
    metadata[
        "decision_threshold"
    ]
)


print(
    f"Model version: "
    f"{metadata['model_version']}"
)

print(
    f"Features required: "
    f"{len(feature_columns)}"
)

print(
    f"Decision threshold: "
    f"{threshold}"
)


# =========================================================
# LOAD ONE REAL SAMPLE
# =========================================================

df = pd.read_csv(
    FEATURE_FILE
)


sample = df.iloc[
    0
]


X = pd.DataFrame(
    [
        {
            feature:
                sample[
                    feature
                ]

            for feature in feature_columns
        }
    ]
)


# =========================================================
# PREDICT
# =========================================================

probability = float(
    model.predict_proba(
        X
    )[0][1]
)


prediction = int(
    probability
    >= threshold
)


# =========================================================
# RISK LABEL
# =========================================================

if probability < 0.20:

    risk_level = "low"

elif probability < threshold:

    risk_level = "moderate"

else:

    risk_level = "elevated"


# =========================================================
# OUTPUT
# =========================================================

print(
    "\n==========================================="
)

print(
    "GLYCOVISION TEST PREDICTION"
)

print(
    "==========================================="
)


print(
    f"Patient: "
    f"{sample['patient_id']}"
)

print(
    f"Current BG: "
    f"{sample['current_bg']}"
)

print(
    f"Actual label: "
    f"{int(sample['spike_risk_label'])}"
)

print(
    f"Predicted probability: "
    f"{probability:.4f}"
)

print(
    f"Threshold: "
    f"{threshold:.2f}"
)

print(
    f"Predicted class: "
    f"{prediction}"
)

print(
    f"Risk level: "
    f"{risk_level}"
)