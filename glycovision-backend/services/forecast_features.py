"""
Feature names and the food/insulin effects shared by training
(ml/train_forecast.py) and live prediction (services/glucose_forecast.py).
Carbs are always in grams, times in minutes.

The forecast is a sum, so every input's share can be shown on its own:

    next hour = food effect + insulin effect + what the AI model adds
                (trend, time of day, heart rate, steps)

Food and insulin are NOT model features. The training patients inject for
big meals, so a model given both learns that big meals hardly raise sugar.
"""

import numpy as np

from services.dose_simulator import carb_fraction_absorbed
from services.iob_engine import iob_fraction_remaining

HORIZONS = [15, 30, 45, 60]
GLUCOSE_LAGS = [5, 10, 15, 20, 30, 45, 60]

WEARABLE_FEATURES = ["hr_15m", "hr_60m", "steps_15m", "steps_60m"]
FEATURES = ["current_bg"] + [f"delta_{lag}" for lag in GLUCOSE_LAGS] + WEARABLE_FEATURES + ["hour_sin", "hour_cos"]

# Rules of thumb: ISF = 1800 / daily dose, ICR = 500 / daily dose. Their
# quotient is the sugar rise per gram of carbs, the same for everyone.
CSF_DEFAULT = 1800 / 500
ISF_DEFAULT = 50.0
# Share of the textbook effect seen on average in the training patients'
# real hour. Chosen by the test in ml/train_forecast.py.
EFFECT_SHARE = 0.2
# The same share for people who don't inject at meals, measured on 1,246 meals
# of 45 people in CGMacros (PhysioNet, CC BY-NC-SA 4.0; a US group, so portions
# and foods differ from Pakistan). With 0.2, people with type 2 were
# predicted +7 mg/dL an hour after eating; the real rise was +46. Each share
# was picked with the tested person left out: error 48.6 -> 41.0 mg/dL for
# type 2, and spikes said 55 % / seen 54 %. Gestational diabetes has no data
# of its own and uses the pre-diabetes value.
FOOD_SHARE = {"Type 2": 0.5, "Gestational": 0.4, "No diabetes": 0.3}
# Measured (error at 60 min, share of real values inside the range) after meals.
MEAL_ACCURACY = {0.5: (41, 0.74), 0.4: (34, 0.80), 0.3: (25, 0.83)}
# For them the range must also allow a meal that hits harder.
NO_INSULIN_REACH = 0.9


def food_share(profile: dict | None) -> float:
    """Share of the textbook food effect that fits this person."""
    p = profile or {}
    if p.get("mealtime_insulin") is True:
        return EFFECT_SHARE
    return FOOD_SHARE.get(p.get("diabetes_type"), EFFECT_SHARE)


def food_rise(meals, start: float, end: float, csf: float) -> float:
    """mg/dL added by carbs absorbed from `start` to `end` minutes from now.
    meals: (grams, minutes ago). Negative minutes are in the past."""
    return csf * sum(
        g * (carb_fraction_absorbed(ago + end) - carb_fraction_absorbed(ago + start)) for g, ago in meals
    )


def insulin_drop(doses, start: float, end: float, isf: float, dia_minutes: float = 240) -> float:
    """mg/dL (negative) removed by logged insulin from `start` to `end` minutes from now."""
    return -isf * sum(
        u * (iob_fraction_remaining(ago + start, dia_minutes) - iob_fraction_remaining(ago + end, dia_minutes))
        for u, ago in doses
    )


def probability_features(bg, lo, mid, hi):
    """How far the predicted hour is from a spike and from a low, in range widths."""
    bg = np.asarray(bg, float)
    need = np.where(bg < 180, np.minimum(40, 180 - bg), 40)
    width = np.maximum(hi - lo, 10)
    spike = np.column_stack([(mid - need) / width, (hi - need) / width])
    low = np.column_stack([(70 - bg - mid) / width, (70 - bg - lo) / width])
    return np.clip(spike, -8, 8), np.clip(low, -8, 8)
