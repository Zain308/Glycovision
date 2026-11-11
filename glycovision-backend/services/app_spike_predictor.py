from pathlib import Path
from datetime import datetime, timedelta, timezone
import json
import math

import joblib
import pandas as pd

from core.db import get_db
from core.user_time import get_profile_row, user_timezone


PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "models" / "spike_prediction"

DENSE_MODEL_FILE = MODEL_DIR / "glycovision_spike_app_final.joblib"
DENSE_METADATA_FILE = MODEL_DIR / "glycovision_spike_app_final_metadata.json"

SPARSE_MODEL_FILE = MODEL_DIR / "glycovision_spike_sparse_final.joblib"
SPARSE_METADATA_FILE = MODEL_DIR / "glycovision_spike_sparse_final_metadata.json"

_dense_model = None
_dense_metadata = None
_sparse_model = None
_sparse_metadata = None

DENSE_OFFSETS = [60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0]
DENSE_TOLERANCE_MINUTES = 3.0

SPARSE_OFFSETS = [60, 30, 15, 0]
SPARSE_TOLERANCE_MINUTES = {
    60: 12.0,
    30: 10.0,
    15: 7.0,
    0: 0.1,
}

MAX_BG_AGE_MINUTES = 10.0
HISTORY_LOOKBACK_MINUTES = 75


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Metadata file not found: {path}")

    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def _load_dense_artifacts():
    global _dense_model, _dense_metadata

    if _dense_model is None:
        if not DENSE_MODEL_FILE.exists():
            raise FileNotFoundError(f"Dense spike model not found: {DENSE_MODEL_FILE}")
        _dense_model = joblib.load(DENSE_MODEL_FILE)

    if _dense_metadata is None:
        _dense_metadata = _load_json(DENSE_METADATA_FILE)

    return _dense_model, _dense_metadata


def _load_sparse_artifacts():
    global _sparse_model, _sparse_metadata

    if _sparse_model is None:
        if not SPARSE_MODEL_FILE.exists():
            raise FileNotFoundError(f"Sparse spike model not found: {SPARSE_MODEL_FILE}")
        _sparse_model = joblib.load(SPARSE_MODEL_FILE)

    if _sparse_metadata is None:
        _sparse_metadata = _load_json(SPARSE_METADATA_FILE)

    return _sparse_model, _sparse_metadata


def _parse_datetime(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_latest_bg_row(user_id: str) -> dict | None:
    db = get_db()
    res = (
        db.table("bg_readings")
        .select("value, logged_at")
        .eq("user_id", user_id)
        .order("logged_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _get_bg_rows(user_id: str, reference_time: datetime) -> list[dict]:
    db = get_db()
    cutoff = (reference_time - timedelta(minutes=HISTORY_LOOKBACK_MINUTES)).isoformat()
    upper_bound = (reference_time + timedelta(seconds=10)).isoformat()

    res = (
        db.table("bg_readings")
        .select("value, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .lte("logged_at", upper_bound)
        .order("logged_at", desc=False)
        .execute()
    )
    return res.data or []


def _get_carbs_60m(user_id: str, reference_time: datetime) -> float:
    db = get_db()
    cutoff = (reference_time - timedelta(minutes=60)).isoformat()

    res = (
        db.table("meals")
        .select("carbs")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .lte("logged_at", reference_time.isoformat())
        .execute()
    )

    return round(
        sum(float(row.get("carbs", 0) or 0) for row in (res.data or [])),
        2,
    )


def _get_bolus_60m(user_id: str, reference_time: datetime) -> float:
    db = get_db()
    cutoff = (reference_time - timedelta(minutes=60)).isoformat()

    res = (
        db.table("bolus_logs")
        .select("dose_units")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .lte("logged_at", reference_time.isoformat())
        .execute()
    )

    return round(
        sum(float(row.get("dose_units", 0) or 0) for row in (res.data or [])),
        2,
    )


def _parse_bg_rows(rows: list[dict]) -> list[dict]:
    parsed = []
    for row in rows:
        try:
            parsed.append({
                "value": float(row["value"]),
                "time": _parse_datetime(row["logged_at"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return parsed


def _assign_unique(
    parsed_rows: list[dict],
    reference_time: datetime,
    offsets: list[int],
    tolerance_for,
) -> dict[int, dict]:
    """
    Match each offset slot to the nearest reading within its tolerance,
    using every reading at most once.

    Without this, one reading can fill two slots (e.g. a reading 22 min
    old is within 7 min of the 15-min slot and 10 min of the 30-min slot),
    which feeds the model duplicated values and a false 0 change.
    Candidate pairs are assigned greedily from the closest match outward.
    """
    candidates = []
    for offset in offsets:
        target = reference_time - timedelta(minutes=offset)
        tolerance = tolerance_for(offset)
        for index, row in enumerate(parsed_rows):
            diff = abs((row["time"] - target).total_seconds()) / 60
            if diff <= tolerance:
                candidates.append((diff, offset, index))

    candidates.sort(key=lambda item: (item[0], item[1]))

    assigned: dict[int, dict] = {}
    used_rows: set[int] = set()

    for diff, offset, index in candidates:
        if offset in assigned or index in used_rows:
            continue
        assigned[offset] = {
            **parsed_rows[index],
            "difference_minutes": diff,
        }
        used_rows.add(index)

    return assigned


def _local_hour(user_id: str, reference_time: datetime) -> float:
    """
    Fractional hour of day in the user's time zone.

    The HUPA-UCM training data uses local clock time, so the model's
    hour_sin/hour_cos features must be computed in local time, not UTC.
    """
    profile = get_profile_row(get_db(), user_id)
    local = reference_time.astimezone(user_timezone(profile))
    return local.hour + local.minute / 60 + local.second / 3600


def _add_context(features: dict, user_id: str, reference_time: datetime) -> dict:
    features["carbs_60m"] = _get_carbs_60m(user_id, reference_time)
    features["bolus_60m"] = _get_bolus_60m(user_id, reference_time)

    hour = _local_hour(user_id, reference_time)
    features["hour_sin"] = float(math.sin(2 * math.pi * hour / 24))
    features["hour_cos"] = float(math.cos(2 * math.pi * hour / 24))

    return features


def _build_dense_features(rows: list[dict], user_id: str, reference_time: datetime):
    parsed = _parse_bg_rows(rows)
    values = {}
    missing = []

    assigned = _assign_unique(
        parsed,
        reference_time,
        DENSE_OFFSETS,
        lambda _offset: DENSE_TOLERANCE_MINUTES,
    )

    for offset in DENSE_OFFSETS:
        match = assigned.get(offset)

        if match is None:
            missing.append(offset)
            continue

        key = "current_bg" if offset == 0 else f"glucose_t_minus_{offset}"
        values[key] = float(match["value"])

    readiness = {
        "available_readings": len(parsed),
        "required_readings": 13,
        "missing_offsets": missing,
    }

    if missing:
        return None, readiness

    current = values["current_bg"]
    values["bg_change_15m"] = current - values["glucose_t_minus_15"]
    values["bg_change_30m"] = current - values["glucose_t_minus_30"]
    values["bg_change_60m"] = current - values["glucose_t_minus_60"]

    ordered_values = [
        values["glucose_t_minus_60"],
        values["glucose_t_minus_55"],
        values["glucose_t_minus_50"],
        values["glucose_t_minus_45"],
        values["glucose_t_minus_40"],
        values["glucose_t_minus_35"],
        values["glucose_t_minus_30"],
        values["glucose_t_minus_25"],
        values["glucose_t_minus_20"],
        values["glucose_t_minus_15"],
        values["glucose_t_minus_10"],
        values["glucose_t_minus_5"],
        current,
    ]

    series = pd.Series(ordered_values, dtype=float)
    values["bg_mean_60m"] = float(series.mean())
    values["bg_std_60m"] = float(series.std())
    values["bg_min_60m"] = float(series.min())
    values["bg_max_60m"] = float(series.max())

    return _add_context(values, user_id, reference_time), readiness


def _build_sparse_features(rows: list[dict], user_id: str, reference_time: datetime):
    parsed = _parse_bg_rows(rows)
    values = {}
    missing = []
    matched = {}

    assigned = _assign_unique(
        parsed,
        reference_time,
        SPARSE_OFFSETS,
        lambda offset: SPARSE_TOLERANCE_MINUTES[offset],
    )

    for offset in SPARSE_OFFSETS:
        match = assigned.get(offset)

        if match is None:
            missing.append(offset)
            continue

        key = "current_bg" if offset == 0 else f"glucose_t_minus_{offset}"
        values[key] = float(match["value"])
        matched[str(offset)] = {
            "actual_time": match["time"].isoformat(),
            "difference_minutes": round(match["difference_minutes"], 2),
        }

    readiness = {
        "available_readings": len(parsed),
        "required_anchors": 4,
        "missing_offsets": missing,
        "matched_offsets": matched,
    }

    if missing:
        return None, readiness

    current = values["current_bg"]
    values["bg_change_15m"] = current - values["glucose_t_minus_15"]
    values["bg_change_30m"] = current - values["glucose_t_minus_30"]
    values["bg_change_60m"] = current - values["glucose_t_minus_60"]

    return _add_context(values, user_id, reference_time), readiness


def build_app_model_features(user_id: str) -> dict:
    request_time = datetime.now(timezone.utc)
    latest_row = _get_latest_bg_row(user_id)

    if latest_row is None:
        return {
            "status": "not_ready",
            "reason": "no_glucose_data",
            "prediction_mode": None,
            "message": "No glucose readings are available yet.",
        }

    try:
        latest_bg = float(latest_row["value"])
        latest_time = _parse_datetime(latest_row["logged_at"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Latest glucose reading is invalid.") from error

    age_minutes = max(
        0.0,
        (request_time - latest_time).total_seconds() / 60,
    )

    if age_minutes > MAX_BG_AGE_MINUTES:
        return {
            "status": "stale",
            "reason": "stale_glucose_data",
            "prediction_mode": None,
            "latest_bg": round(latest_bg, 1),
            "latest_bg_at": latest_time.isoformat(),
            "age_minutes": round(age_minutes, 1),
            "max_age_minutes": MAX_BG_AGE_MINUTES,
            "message": (
                "The latest glucose reading is too old for a current "
                "60-minute risk estimate. Log a new BG reading or wait "
                "for a new CGM value."
            ),
        }

    rows = _get_bg_rows(user_id, latest_time)

    dense_features, dense_readiness = _build_dense_features(
        rows,
        user_id,
        latest_time,
    )

    if dense_features is not None:
        return {
            "status": "ready",
            "prediction_mode": "dense",
            "features": dense_features,
            "readiness": dense_readiness,
            "generated_at": request_time.isoformat(),
            "prediction_reference_time": latest_time.isoformat(),
            "latest_bg_age_minutes": round(age_minutes, 1),
        }

    sparse_features, sparse_readiness = _build_sparse_features(
        rows,
        user_id,
        latest_time,
    )

    if sparse_features is not None:
        return {
            "status": "ready",
            "prediction_mode": "sparse",
            "features": sparse_features,
            "readiness": sparse_readiness,
            "dense_fallback_reason": {
                "missing_offsets_minutes": dense_readiness["missing_offsets"],
            },
            "generated_at": request_time.isoformat(),
            "prediction_reference_time": latest_time.isoformat(),
            "latest_bg_age_minutes": round(age_minutes, 1),
        }

    return {
        "status": "not_ready",
        "reason": "insufficient_glucose_history",
        "prediction_mode": None,
        "latest_bg": round(latest_bg, 1),
        "latest_bg_at": latest_time.isoformat(),
        "latest_bg_age_minutes": round(age_minutes, 1),
        "dense_model": {
            "required_readings": 13,
            "available_readings": dense_readiness["available_readings"],
            "missing_offsets_minutes": dense_readiness["missing_offsets"],
        },
        "sparse_model": {
            "required_anchors": 4,
            "available_readings": sparse_readiness["available_readings"],
            "missing_offsets_minutes": sparse_readiness["missing_offsets"],
            "matched_offsets": sparse_readiness["matched_offsets"],
        },
        "message": (
            "The latest glucose reading is fresh, but GlycoVision does not "
            "yet have enough historical glucose data for either the dense "
            "CGM model or the sparse manual-BG fallback model."
        ),
    }


def _risk_level(score: float, threshold: float) -> str:
    if score < 0.14:
        return "low"
    if score < threshold:
        return "moderate"
    return "elevated"


def _run_model(model, metadata: dict, features: dict):
    required = metadata["feature_columns"]
    missing = [name for name in required if name not in features]

    if missing:
        raise ValueError(
            "Model feature construction failed. Missing: "
            + ", ".join(missing)
        )

    ordered = {name: float(features[name]) for name in required}
    X = pd.DataFrame([ordered], columns=required)

    probability = float(model.predict_proba(X)[0][1])
    threshold = float(metadata["decision_threshold"])

    return probability, threshold


def predict_user_spike_risk(user_id: str) -> dict:
    prepared = build_app_model_features(user_id)

    if prepared["status"] != "ready":
        return prepared

    mode = prepared["prediction_mode"]
    features = prepared["features"]

    if mode == "dense":
        model, metadata = _load_dense_artifacts()
    elif mode == "sparse":
        model, metadata = _load_sparse_artifacts()
    else:
        raise ValueError(f"Unknown prediction mode: {mode}")

    probability, threshold = _run_model(model, metadata, features)

    result = {
        "status": "ready",
        "prediction_mode": mode,
        "model_version": metadata["model_version"],
        "feature_count": int(metadata.get("feature_count", len(metadata["feature_columns"]))),
        "prediction_horizon_minutes": int(metadata.get("prediction_horizon_minutes", 60)),
        "risk_score": round(probability, 4),
        "risk_percent": round(probability * 100, 1),
        "risk_level": _risk_level(probability, threshold),
        "elevated_risk": bool(probability >= threshold),
        "decision_threshold": threshold,
        "current_bg": round(features["current_bg"], 1),
        "bg_change_15m": round(features["bg_change_15m"], 1),
        "bg_change_30m": round(features["bg_change_30m"], 1),
        "bg_change_60m": round(features["bg_change_60m"], 1),
        "carbs_60m": round(features["carbs_60m"], 1),
        "bolus_60m": round(features["bolus_60m"], 2),
        "prediction_reference_time": prepared["prediction_reference_time"],
        "latest_bg_age_minutes": prepared["latest_bg_age_minutes"],
        "generated_at": prepared["generated_at"],
        "disclaimer": (
            "Research prediction only. This score is not a diagnosis, "
            "treatment recommendation, or insulin-dosing instruction."
        ),
    }

    if mode == "sparse":
        result["sparse_anchor_matches"] = prepared["readiness"].get(
            "matched_offsets",
            {},
        )

    return result


def get_app_spike_model_info():
    _, dense_metadata = _load_dense_artifacts()
    _, sparse_metadata = _load_sparse_artifacts()

    return {
        "selection_strategy": "dense_first_then_sparse_fallback",
        "max_bg_age_minutes": MAX_BG_AGE_MINUTES,
        "dense_model": {
            "model_name": dense_metadata.get("model_name"),
            "model_version": dense_metadata.get("model_version"),
            "model_type": dense_metadata.get("model_type"),
            "feature_count": dense_metadata.get("feature_count"),
            "prediction_horizon_minutes": dense_metadata.get("prediction_horizon_minutes"),
            "decision_threshold": dense_metadata.get("decision_threshold"),
            "nested_evaluation": dense_metadata.get("nested_evaluation", {}),
        },
        "sparse_model": {
            "model_name": sparse_metadata.get("model_name"),
            "model_version": sparse_metadata.get("model_version"),
            "model_type": sparse_metadata.get("model_type"),
            "feature_count": sparse_metadata.get("feature_count"),
            "prediction_horizon_minutes": sparse_metadata.get("prediction_horizon_minutes"),
            "decision_threshold": sparse_metadata.get("decision_threshold"),
            "nested_evaluation": sparse_metadata.get("nested_evaluation", {}),
        },
        "sparse_anchor_tolerances_minutes": SPARSE_TOLERANCE_MINUTES,
    }
