"""
Live 60-minute glucose forecast: path, range, direction and size.

The forecast is a sum: food and insulin effects (textbook curves with the
patient's own ratios) plus what the AI model adds (trend, time of day, heart
rate, steps) plus, when this patient's own checks show one, a stress effect.
Each share is returned in `effects`, and they add up to the change shown.

Works with one finger-prick up to a full CGM, with or without a watch;
missing inputs are passed as missing and widen the range.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.interpolate import PchipInterpolator

from core.db import get_db
from core.user_time import get_profile_row, local_day_start_utc_iso, user_timezone
from services import health_data
from services.app_spike_predictor import _assign_unique, _parse_bg_rows
from services.forecast_features import (
    CSF_DEFAULT, EFFECT_SHARE, FEATURES, GLUCOSE_LAGS, HORIZONS, ISF_DEFAULT, MEAL_ACCURACY, NO_INSULIN_REACH, WEARABLE_FEATURES,
    food_rise, food_share, insulin_drop, probability_features,
)
from services.iob_engine import effective_dia_hours

MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "forecast"
MAX_BG_AGE_MIN = 15
LAG_TOLERANCE = {5: 2.5, 10: 2.5, 15: 5, 20: 4, 30: 8, 45: 8, 60: 10}
STEADY = 20            # mg/dL in an hour; smaller changes are called steady
LIKELY = 0.4           # chance at which a spike or low is called likely
CLIP = (40, 400)

_cache: dict = {}


def load_models():
    if not _cache:
        _cache["meta"] = json.loads((MODEL_DIR / "forecast_metadata.json").read_text())
        _cache["models"] = joblib.load(MODEL_DIR / "forecast.joblib")
    return _cache["models"], _cache["meta"]


# ------------------------------------------------------------- features

def glucose_features(readings: list[dict], t0: datetime) -> dict:
    """readings: [{'value', 'time'}]; the one at t0 is the current reading."""
    current = min(readings, key=lambda r: abs((r["time"] - t0).total_seconds()))
    earlier = [r for r in readings if r["time"] < current["time"]]
    assigned = _assign_unique(earlier, t0, GLUCOSE_LAGS, lambda lag: LAG_TOLERANCE[lag])
    out = {"current_bg": current["value"]}
    for lag in GLUCOSE_LAGS:
        match = assigned.get(lag)
        if match is None:
            out[f"delta_{lag}"] = None
            continue
        minutes = (t0 - match["time"]).total_seconds() / 60
        # Rescale to exactly `lag` minutes: 22 min of change is not 20 min.
        out[f"delta_{lag}"] = (current["value"] - match["value"]) * lag / minutes
    return out


def situation(features: dict) -> str:
    """Which tested situation this matches (sets range width and accuracy)."""
    lags = sum(features[f"delta_{lag}"] is not None for lag in GLUCOSE_LAGS)
    watch = features["hr_15m"] is not None or features["steps_15m"] is not None
    if lags >= 5:
        return "cgm_watch" if watch else "cgm"
    if lags >= 2:
        return "fingerstick_3"
    if lags == 1:
        return "fingerstick_1"
    return "single_watch" if watch else "single"


# ------------------------------------------------------------- prediction

def _ai_quantiles(models, features: dict) -> dict:
    """{horizon: (low, middle, high)} change from the AI model alone."""
    x = pd.DataFrame([{f: features.get(f) for f in FEATURES}], columns=FEATURES).astype(float)
    return {h: sorted(float(models[f"q{q}_{h}"].predict(x)[0]) for q in (10, 50, 90)) for h in HORIZONS}


def _without(features: dict, names) -> dict:
    return {**features, **{n: None for n in names}}


def predict(
    features: dict, food: dict | None = None, insulin: dict | None = None, stress: float = 0.0,
    eaten_share: float = EFFECT_SHARE,
) -> dict:
    """`food` and `insulin`: full textbook effect in mg/dL per horizon.
    `eaten_share`: share of the food effect that fits this person.
    `stress`: this patient's own measured effect after 60 minutes."""
    models, meta = load_models()
    share, reach = meta["effect_share"], meta["reach"]
    food = food or {h: 0.0 for h in HORIZONS}
    insulin = insulin or {h: 0.0 for h in HORIZONS}
    sit = situation(features)
    margin = meta["band_margins"][sit]
    bg = float(features["current_bg"])
    ai = _ai_quantiles(models, features)

    knots = {"low": [bg], "mid": [bg], "high": [bg]}
    for h in HORIZONS:
        net = food[h] + insulin[h]
        add = eaten_share * food[h] + share * insulin[h] + stress * h / 60
        lo, mid, hi = (v + add for v in ai[h])
        if h == 60:
            z = (lo, mid, hi)
        m = margin[str(h)]
        up, down = reach[str(h)]
        # A meal that hits hard, or insulin that works fully, stays in range.
        hi = max(hi + m, mid + up * max(0.0, net))
        lo = min(lo - m, mid + down * min(0.0, net))
        if eaten_share > share:
            hi = max(hi, mid + (NO_INSULIN_REACH - eaten_share) * food[h])
            lo -= (eaten_share - share) * food[h]
        knots["low"].append(bg + lo)
        knots["mid"].append(bg + mid)
        knots["high"].append(bg + hi)

    minutes = np.arange(0, 61, 5)
    lines = {}
    for name, values in knots.items():
        curve = PchipInterpolator([0] + HORIZONS, np.clip(values, *CLIP))(minutes)
        lines[name] = [round(float(v)) for v in curve]
    points = [
        {"minute": int(m), "low": lines["low"][i], "mid": lines["mid"][i], "high": lines["high"][i]}
        for i, m in enumerate(minutes)
    ]

    change = points[-1]["mid"] - points[0]["mid"]
    top = max(points, key=lambda p: p["mid"])
    bottom = min(points, key=lambda p: p["mid"])
    zs, zl = probability_features([bg], *(np.array([v]) for v in z))
    spike_p = float(models["spike"].predict_proba(zs)[0][1])
    low_p = float(models["low"].predict_proba(zl)[0][1])
    # The middle line is cautious, so a likely low or spike decides the
    # direction first: the label must never say "steady" under a warning.
    if low_p >= LIKELY:
        direction = "down"
    elif spike_p >= LIKELY:
        direction = "up"
    else:
        direction = "up" if change >= STEADY else "down" if change <= -STEADY else "steady"
    tested = meta["evaluation"][sit]
    h60 = tested["horizons"]["60"]
    error, inside = h60["mae"], h60["coverage"]
    if food[60] > 20 and eaten_share in MEAL_ACCURACY:
        error, inside = MEAL_ACCURACY[eaten_share]
    return {
        "points": points,
        "direction": direction,
        "change_60": change,
        "range_60": [points[-1]["low"], points[-1]["high"]],
        "peak": {"minute": top["minute"], "bg": top["mid"]},
        "lowest": {"minute": bottom["minute"], "bg": bottom["mid"]},
        "spike_probability": round(spike_p, 3),
        "low_probability": round(low_p, 3),
        "effects": _effects(models, features, ai, change, share, eaten_share, food, insulin, stress),
        "based_on": sit,
        "typical_error_60": round(error),
        "range_coverage": round(inside, 2),
        "model_version": meta["model_version"],
    }


def _effects(models, features, ai, change, share, eaten_share, food, insulin, stress) -> dict:
    """Each input's share of the 60-minute change, in mg/dL. They add up to it."""
    out = {
        "food": round(eaten_share * food[60]),
        "insulin": round(share * insulin[60]),
        "stress": round(stress),
        "movement": 0,
    }
    if any(features.get(n) is not None for n in WEARABLE_FEATURES):
        out["movement"] = round(ai[60][1] - _ai_quantiles(models, _without(features, WEARABLE_FEATURES))[60][1])
    # What is left is the sugar trend (and time of day).
    out["trend"] = change - sum(out.values())
    return out


def alert_level(bg: float, f: dict) -> tuple[str, str, str]:
    """(level, title, message) for the forecast card."""
    low_p, spike_p = f["low_probability"], f["spike_probability"]
    change = f["change_60"]
    if bg < 70:
        return "urgent", "Low sugar now", "Take 15 g of fast sugar now and check again in 15 minutes."
    if low_p >= LIKELY:
        return "urgent", "High risk of a low within the hour", (
            f"About {round(low_p * 100)}% chance of going below 70. Check again soon and keep fast sugar close.")
    if bg > 250:
        return "high", "Very high sugar now", "Follow your care plan and drink water. Check ketones if you can."
    if spike_p >= LIKELY:
        return "high", "High risk of a sugar spike", (
            f"About {round(spike_p * 100)}% chance of a sharp rise in the next hour.")
    if low_p >= 0.2:
        return "watch", "Your sugar may drop", f"About {round(low_p * 100)}% chance of going below 70. Check again in 30 minutes."
    if spike_p >= 0.2:
        return "watch", "Your sugar may rise", f"About {round(spike_p * 100)}% chance of a sharp rise in the next hour."
    if str(f.get("based_on", "")).startswith("single"):
        # One reading can't show a trend, so never reassure from it.
        return "watch", "One more reading needed", (
            "One reading can't show where your sugar is heading. Check again in 15 to 30 minutes.")
    if bg > 180:
        return "watch", "Above your target", "Your sugar is high but not expected to change sharply."
    if abs(change) < STEADY:
        return "calm", "Looks steady", "No sharp change is expected in the next hour."
    return "calm", "Small change expected", "Your sugar should stay in a comfortable range."


# ------------------------------------------------------------- live data

def _time_rows(table: str, columns: str, user_id: str, since: datetime) -> list[dict]:
    res = (
        get_db().table(table).select(columns).eq("user_id", user_id)
        .gte("logged_at", since.isoformat()).order("logged_at", desc=False).execute()
    )
    out = []
    for r in res.data or []:
        try:
            out.append({**r, "_t": health_data.parse_time(r["logged_at"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def load_context(user_id: str, now: datetime, profile: dict | None) -> dict:
    """Everything the care plan needs, read once."""
    since = now - timedelta(hours=8)
    midnight = health_data.parse_time(local_day_start_utc_iso(user_timezone(profile)))
    return {
        "readings": [r for r in _parse_bg_rows(_time_rows("bg_readings", "value, logged_at", user_id, since)) if r["value"] > 0],
        "meals": _time_rows("meals", "food_name, carbs, calories, logged_at", user_id, min(since, midnight)),
        "doses": _time_rows("bolus_logs", "dose_units, logged_at", user_id, since),
        "wearable": health_data.wearable_features(user_id, now),
        "hour": (lambda t: t.hour + t.minute / 60)(now.astimezone(user_timezone(profile))),
    }


def personal_ratios(profile: dict | None) -> tuple[float, float, float]:
    """(sugar rise per gram, drop per unit, insulin minutes) for this patient."""
    p = profile or {}
    isf, icr, weight = (float(p.get(k) or 0) for k in ("isf", "icr", "weight_kg"))
    csf = isf / icr if isf > 0 and icr > 0 else CSF_DEFAULT
    if isf <= 0:
        # Body weight stands in for a missing ratio: about 0.5 units per kg a day.
        isf = 1800 / (0.5 * weight) if weight > 0 else ISF_DEFAULT
    return min(max(csf, 1.0), 12.0), min(max(isf, 10.0), 200.0), effective_dia_hours(p.get("dia_hours")) * 60


def context_effects(ctx: dict, now: datetime, profile: dict | None, extra_carbs: float = 0.0):
    """(meals, doses, ratios) as (amount, minutes ago) lists."""
    ago = lambda r: (now - r["_t"]).total_seconds() / 60
    meals = [(float(m.get("carbs") or 0), ago(m)) for m in ctx["meals"] if ago(m) >= 0]
    if extra_carbs:
        meals.append((extra_carbs, 0.0))
    doses = [(float(d.get("dose_units") or 0), ago(d)) for d in ctx["doses"] if ago(d) >= 0]
    return meals, doses, personal_ratios(profile)


def forecast_from_context(
    ctx: dict, now: datetime, extra_carbs: float = 0.0, profile: dict | None = None, stress: float = 0.0,
) -> dict:
    if not ctx["readings"]:
        return {"status": "no_reading", "message": "Log your blood sugar to see the next 60 minutes."}
    latest = max(ctx["readings"], key=lambda r: r["time"])
    age = max(0.0, (now - latest["time"]).total_seconds() / 60)
    if age > MAX_BG_AGE_MIN:
        return {
            "status": "stale", "age_minutes": round(age), "last_bg": round(latest["value"]),
            "message": f"Your last reading is {round(age)} minutes old. Log a new one to see the next 60 minutes.",
        }
    meals, doses, (csf, isf, dia) = context_effects(ctx, now, profile, extra_carbs)
    features = {
        **glucose_features(ctx["readings"], latest["time"]), **ctx["wearable"],
        "hour_sin": math.sin(2 * math.pi * ctx["hour"] / 24), "hour_cos": math.cos(2 * math.pi * ctx["hour"] / 24),
    }
    # The model sees the part of the trend that food and insulin don't explain.
    share, eaten = load_models()[1]["effect_share"], food_share(profile)
    known = [(u, a - age) for u, a in meals], [(u, a - age) for u, a in doses]
    for lag in GLUCOSE_LAGS:
        if features[f"delta_{lag}"] is not None:
            features[f"delta_{lag}"] -= (
                eaten * food_rise(known[0], -lag, 0, csf) + share * insulin_drop(known[1], -lag, 0, isf, dia))
    result = predict(
        features,
        {h: food_rise(meals, 0, h, csf) for h in HORIZONS},
        {h: insulin_drop(doses, 0, h, isf, dia) for h in HORIZONS},
        stress,
        eaten,
    )
    level, title, message = alert_level(latest["value"], result)
    ago = lambda t: round((now - t).total_seconds() / 60)
    return {
        "status": "ready", "current_bg": round(latest["value"]), "reading_at": latest["time"].isoformat(),
        "alert": level, "title": title, "message": message,
        "used_watch": features["hr_15m"] is not None or features["steps_15m"] is not None,
        "carbs_counted": round(sum(g for g, a in meals if a <= 120)), **result,
        "history": [
            {"minute": round(age) - ago(r["time"]), "bg": round(r["value"])}
            for r in sorted(ctx["readings"], key=lambda r: r["time"]) if ago(r["time"]) <= 60
        ],
        "disclaimer": "Estimate from a research model. It can be wrong; confirm with a blood test before acting.",
    }


def user_forecast(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    profile = get_profile_row(get_db(), user_id)
    return forecast_from_context(load_context(user_id, now, profile), now, profile=profile)
