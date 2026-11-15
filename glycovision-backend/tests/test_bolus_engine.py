"""
Insulin dose engine (services/bolus_engine.py): the most safety-critical
code in the app. Formula: carbs/ICR + max(0, (BG-target)/ISF) - IOB,
never negative, 0 below 70 mg/dL, capped at 15 u.
"""

import itertools
import math

import pytest
from pydantic import ValidationError

from models.schemas import PatientState
from services.bolus_engine import MAX_PROTOTYPE_DOSE, calculate_safe_bolus


def state(**kw):
    base = dict(current_bg=150, target_bg=110, isf=50, iob=0, total_carbs=60, icr=10)
    base.update(kw)
    return PatientState(**base)


# ---------------------------------------------------------------- formula

def test_meal_plus_correction():
    r = calculate_safe_bolus(state())
    # 60/10 = 6.0 meal, (150-110)/50 = 0.8 correction
    assert r.breakdown.carb_dose_units == 6.0
    assert r.breakdown.correction_dose_units == 0.8
    assert r.recommended_total_dose_units == 6.8


def test_iob_is_subtracted():
    r = calculate_safe_bolus(state(iob=1.4))
    assert r.recommended_total_dose_units == pytest.approx(5.4)
    assert r.breakdown.iob_subtracted == 1.4


def test_zero_carbs_correction_only():
    r = calculate_safe_bolus(state(total_carbs=0, current_bg=210))
    assert r.recommended_total_dose_units == 2.0  # (210-110)/50


def test_rounded_to_one_decimal():
    r = calculate_safe_bolus(state(total_carbs=37, icr=9, current_bg=110))
    assert r.recommended_total_dose_units == round(37 / 9, 1)


# ---------------------------------------------------------------- safety

def test_low_bg_gives_zero_and_flag():
    r = calculate_safe_bolus(state(current_bg=65, total_carbs=80))
    assert r.recommended_total_dose_units == 0.0
    assert any("Low glucose" in f for f in r.safety_flags)


@pytest.mark.parametrize("bg", [69, 69.9])
def test_just_below_70_is_blocked(bg):
    assert calculate_safe_bolus(state(current_bg=bg)).recommended_total_dose_units == 0.0


def test_exactly_70_is_not_blocked():
    assert calculate_safe_bolus(state(current_bg=70)).recommended_total_dose_units > 0


def test_iob_larger_than_dose_never_negative():
    r = calculate_safe_bolus(state(iob=20))
    assert r.recommended_total_dose_units == 0.0


def test_cap_at_prototype_maximum():
    r = calculate_safe_bolus(state(total_carbs=400, icr=2, current_bg=500))
    assert r.recommended_total_dose_units == MAX_PROTOTYPE_DOSE
    assert any("cap" in f for f in r.safety_flags)


def test_stacking_flag_when_iob_high():
    assert any("stacking" in f for f in calculate_safe_bolus(state(iob=5.5)).safety_flags)


def test_very_high_bg_flag():
    assert any("Very high" in f for f in calculate_safe_bolus(state(current_bg=300)).safety_flags)


def test_disclaimer_always_present():
    assert "not a prescription" in calculate_safe_bolus(state()).disclaimer


# Exhaustive grid: whatever the inputs, the dose stays in [0, cap] and is
# finite. 6 x 5 x 5 x 4 x 5 x 4 = 12,000 combinations.
GRID = itertools.product(
    [21, 55, 69.9, 70, 140, 599],      # current_bg
    [70.1, 100, 120, 150, 179.9],      # target
    [5.1, 20, 50, 100, 149.9],         # isf
    [0, 1.5, 5, 40],                   # iob
    [0, 15, 60, 200, 500],             # carbs (500 g = upper limit)
    [1.1, 5, 15, 49.9],                # icr
)


def test_dose_always_within_safe_bounds():
    for bg, tgt, isf, iob, carbs, icr in GRID:
        r = calculate_safe_bolus(PatientState(current_bg=bg, target_bg=tgt, isf=isf, iob=iob, total_carbs=carbs, icr=icr))
        d = r.recommended_total_dose_units
        assert math.isfinite(d) and 0 <= d <= MAX_PROTOTYPE_DOSE, (bg, tgt, isf, iob, carbs, icr, d)
        if bg < 70:
            assert d == 0


# ---------------------------------------------------------------- input validation

@pytest.mark.parametrize(
    "field,value",
    [
        ("current_bg", 20), ("current_bg", 600), ("current_bg", -5),
        ("target_bg", 70), ("target_bg", 180),
        ("isf", 5), ("isf", 150), ("isf", 0),
        ("icr", 1), ("icr", 50), ("icr", 0),
        ("total_carbs", -1), ("iob", -0.1),
    ],
)
def test_out_of_range_inputs_rejected(field, value):
    with pytest.raises(ValidationError):
        state(**{field: value})


def test_nan_bg_rejected():
    with pytest.raises(ValidationError):
        state(current_bg=float("nan"))


# ---------------------------------------------------------------- limits
# Fixed after QA: typos like 6000 g carbs or 1000 u IOB are rejected.

@pytest.mark.parametrize("ok", [0, 250, 500])
def test_realistic_carbs_accepted(ok):
    assert calculate_safe_bolus(state(total_carbs=ok)).recommended_total_dose_units >= 0


def test_unrealistic_carbs_rejected():
    """A typo like 6000 g instead of 60 g should be rejected, not silently capped."""
    with pytest.raises(ValidationError):
        state(total_carbs=6000)


def test_unrealistic_iob_rejected():
    """IOB has no upper limit; 1000 u is accepted."""
    with pytest.raises(ValidationError):
        state(iob=1000)


@pytest.mark.xfail(reason="OPEN: reverse correction needs a clinical decision (QA finding #1)", strict=True)
def test_below_target_reduces_meal_dose():
    """
    Reverse correction: at 80 mg/dL with target 110 and ISF 50, standard
    bolus calculators subtract 0.6 u from the meal dose. The engine clamps
    the correction to 0, so it suggests the full 6.0 u.
    """
    r = calculate_safe_bolus(state(current_bg=80))
    assert r.recommended_total_dose_units < 6.0
