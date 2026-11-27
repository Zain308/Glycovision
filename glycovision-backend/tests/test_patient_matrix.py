"""
Every kind of patient, every kind of moment, through the real plan.

Each case runs build_care_plan with the real forecast model and checks the
rules that must hold for everyone:
  * the forecast is well formed and its parts add up;
  * insulin is never suggested when it must not be, and never raised by
    stress, a planned walk or anything but food and sugar;
  * activity is blocked when sugar is low, and asks for ketones when very high;
  * every message is plain text a patient can read;
  * inputs, links and the time line agree with each other.
"""

import itertools
import json
import math
from datetime import datetime, timedelta, timezone

import pytest

from services import care_plan as cp
from services import glucose_forecast as gf

pytestmark = pytest.mark.skipif(not (gf.MODEL_DIR / "forecast.joblib").exists(), reason="forecast model not trained")

RAPID = {"mealtime_insulin": True, "insulin_type": "rapid", "icr": 10, "isf": 50, "target_bg": 110, "dia_hours": 4}
BODY = {"sex": "female", "birth_year": 1975, "height_cm": 160, "weight_kg": 72}
PROFILES = {
    "type1_rapid": {"diabetes_type": "Type 1", **RAPID, **BODY},
    "type1_regular": {"diabetes_type": "Type 1", **RAPID, "insulin_type": "regular", **BODY},
    "type1_no_ratios": {"diabetes_type": "Type 1", "mealtime_insulin": True, "insulin_type": "rapid"},
    "type2_tablets": {"diabetes_type": "Type 2", "mealtime_insulin": False, **BODY},
    "type2_premixed": {"diabetes_type": "Type 2", **RAPID, "insulin_type": "premixed", **BODY},
    "type2_other": {"diabetes_type": "Type 2", **RAPID, "insulin_type": "other"},
    "gestational": {"diabetes_type": "Gestational", **RAPID, "sex": "female", "birth_year": 1996, "height_cm": 158, "weight_kg": 68},
    "no_diabetes": {"diabetes_type": "No diabetes", "mealtime_insulin": False, **BODY},
    "new_user": {},
}
# (value, minutes ago), newest first.
SUGARS = {
    "none": [],
    "stale": [(150, 40)],
    "very_low": [(45, 2)],
    "low": [(64, 2), (80, 17)],
    "falling": [(88, 1), (110, 16), (135, 31)],
    "normal_one": [(115, 3)],
    "rising": [(165, 1), (140, 16), (120, 31)],
    "high_steady": [(230, 2), (228, 17)],
    "very_high": [(330, 1), (310, 16)],
    "sensor_rising": [(130 + 3 * (12 - i), 5 * i) for i in range(13)],
}
MEALS = {"none": [], "just_ate": [(60, 10)], "big_meal": [(150, 20)], "earlier": [(45, 100)]}
DOSES = {"none": [], "recent": [(6, 30)]}


def plan_for(monkeypatch, profile, sugars, meals, doses, *, stress=None, active=0, carbs=None):
    now = datetime.now(timezone.utc)
    t = lambda m: now - timedelta(minutes=m)
    context = {
        "readings": [{"value": float(v), "time": t(m)} for v, m in sugars],
        "meals": [{"food_name": "Biryani", "carbs": c, "calories": c * 5, "_t": t(m), "logged_at": t(m).isoformat()} for c, m in meals],
        "doses": [{"dose_units": u, "_t": t(m), "logged_at": t(m).isoformat()} for u, m in doses],
        "wearable": {"hr_15m": None, "hr_60m": None, "steps_15m": None, "steps_60m": None},
        "hour": 13.0,
    }
    today = {
        "sitting_min": None, "connected": False, "steps": 1500, "active_kcal": None, "heart_rate": None,
        "manual_minutes": active, "last_sync": None,
        "manual": [{"activity": "Walk", "minutes": active, "logged_at": t(30).isoformat()}] if active else [],
    }
    monkeypatch.setattr(cp, "get_db", lambda: None)
    monkeypatch.setattr(cp, "get_profile_row", lambda db, uid: profile)
    monkeypatch.setattr(cp, "load_context", lambda uid, n, p: context)
    monkeypatch.setattr(cp.health_data, "today_summary", lambda uid, start: today)
    monkeypatch.setattr(cp, "stress_gauge", lambda uid: {"level": stress, "basis": "voice"} if stress else {"level": None})
    monkeypatch.setattr(cp, "stress_shift", lambda uid, level: 15.0 if level == "elevated" else 0.0)
    return cp.build_care_plan("u1", carbs)


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings(v)


def numbers(x):
    if isinstance(x, bool):
        return
    if isinstance(x, (int, float)):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from numbers(v)
    elif isinstance(x, list):
        for v in x:
            yield from numbers(v)


def check(plan, profile, sugars):
    json.dumps(plan)                                        # it can be sent to the phone
    for s in strings(plan):
        assert "None" not in s and "nan" not in s.lower().split() and "{" not in s, s
    assert all(math.isfinite(n) for n in numbers(plan))

    f, ins, act = plan["forecast"], plan["insulin"], plan["activity"]
    assert f["message"] and ins["message"] and act["headline"]
    bg = sugars[0][0] if sugars else None
    fresh = bool(sugars) and sugars[0][1] <= gf.MAX_BG_AGE_MIN

    # ---- forecast
    assert f["status"] == ("ready" if fresh else "stale" if sugars else "no_reading")
    if f["status"] == "ready":
        pts = f["points"]
        assert [p["minute"] for p in pts] == list(range(0, 61, 5))
        assert pts[0]["mid"] == round(bg)
        assert all(30 <= p["low"] <= p["mid"] <= p["high"] <= 600 for p in pts)
        assert abs(sum(f["effects"].values()) - f["change_60"]) <= 1.01
        assert 0 <= f["spike_probability"] <= 1 and 0 <= f["low_probability"] <= 1
        assert f["range_60"][0] <= pts[-1]["mid"] <= f["range_60"][1]
        if bg < 70:
            assert f["alert"] == "urgent"

    # ---- insulin
    units = ins.get("units") or 0
    assert units >= 0
    if units:
        assert ins["status"] == "dose" and units >= cp.MIN_DOSE
        assert f["status"] == "ready" and bg >= 70
        assert units <= ins["test"]["formula_units"] + 1e-9    # never more than the formula
        assert ins["test"]["lowest_with"] >= 70                 # never doses into a low
        assert profile.get("mealtime_insulin") and profile.get("insulin_type") in ("rapid", "regular")
    if bg is not None and bg < 70 and fresh:
        assert ins["status"] in ("blocked_low", "not_needed", "setup", "unsupported")
    if profile.get("mealtime_insulin") is False or profile.get("diabetes_type") == "No diabetes":
        assert ins["status"] == "not_needed"
    if profile.get("insulin_type") in ("premixed", "other"):
        assert ins["status"] == "unsupported" and "doctor" in ins["message"]

    # ---- activity
    if fresh and bg < 70:
        assert act["status"] == "blocked" and not act["options"]
    if fresh and bg > 250 and profile.get("diabetes_type") not in (None, "No diabetes"):
        assert any("ketone" in s.lower() for s in act["safety"] + [act["why"], act["headline"]])
    if not fresh and profile.get("diabetes_type") not in (None, "No diabetes"):
        assert act["status"] == "need_reading"
    if units or (ins.get("iob") or 0) >= 1:
        assert all(o["intensity"] != "Moderate" or o["key"] != "walk_brisk" or units == 0 for o in act["options"])
    for o in act["options"]:
        assert 1 <= o["minutes"] <= 60

    # ---- inputs, links, time line
    keys = {i["key"] for i in plan["inputs"]}
    assert {"sugar", "food", "stress", "activity", "body"} <= keys
    sugar = next(i for i in plan["inputs"] if i["key"] == "sugar")
    assert sugar["ready"] == fresh
    for link in plan["links"]:
        assert link["from"] in keys | {"forecast", "insulin", "move"} and link["to"] in ("forecast", "insulin", "move")
        assert link["text"]
    assert plan["recheck_minutes"] is None or 0 <= plan["recheck_minutes"] <= 240
    for e in plan["events"]:
        assert -75 <= e["minute"] <= gf.MAX_BG_AGE_MIN + 1 and e["amount"] >= 0


CASES = list(itertools.product(PROFILES, SUGARS, MEALS, DOSES))


@pytest.mark.parametrize("who,sugar,meal,dose", CASES, ids=["-".join(c) for c in CASES])
def test_every_patient_every_moment(monkeypatch, who, sugar, meal, dose):
    profile = PROFILES[who]
    plan = plan_for(monkeypatch, profile, SUGARS[sugar], MEALS[meal], DOSES[dose])
    check(plan, profile, SUGARS[sugar])


SOME = [(w, s) for w in ("type1_rapid", "type2_tablets", "gestational", "no_diabetes") for s in ("normal_one", "rising", "high_steady", "falling")]


@pytest.mark.parametrize("who,sugar", SOME)
def test_stress_never_changes_the_dose(monkeypatch, who, sugar):
    calm = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], MEALS["just_ate"], [])
    tense = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], MEALS["just_ate"], [], stress="elevated")
    check(tense, PROFILES[who], SUGARS[sugar])
    assert tense["insulin"].get("units") == calm["insulin"].get("units")
    assert tense["forecast"]["change_60"] >= calm["forecast"]["change_60"]


@pytest.mark.parametrize("who,sugar", SOME)
def test_recent_walk_can_only_lower_the_dose(monkeypatch, who, sugar):
    sat = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], MEALS["just_ate"], [])
    walked = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], MEALS["just_ate"], [], active=40)
    check(walked, PROFILES[who], SUGARS[sugar])
    assert (walked["insulin"].get("units") or 0) <= (sat["insulin"].get("units") or 0)


@pytest.mark.parametrize("who,sugar", SOME)
def test_planned_meal_raises_forecast_and_dose_never_falls(monkeypatch, who, sugar):
    now = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], [], [])
    meal = plan_for(monkeypatch, PROFILES[who], SUGARS[sugar], [], [], carbs=90)
    check(meal, PROFILES[who], SUGARS[sugar])
    assert meal["forecast"]["change_60"] >= now["forecast"]["change_60"]
    assert meal["forecast"]["spike_probability"] >= now["forecast"]["spike_probability"] - 1e-9
    assert (meal["insulin"].get("units") or 0) >= (now["insulin"].get("units") or 0)
    assert any(e["kind"] == "food" and e["amount"] == 90 for e in meal["events"])


def test_insulin_just_taken_lowers_the_next_dose(monkeypatch):
    p = PROFILES["type1_rapid"]
    fresh = plan_for(monkeypatch, p, SUGARS["high_steady"], MEALS["just_ate"], [])
    covered = plan_for(monkeypatch, p, SUGARS["high_steady"], MEALS["just_ate"], [(6, 5)])
    assert (covered["insulin"].get("units") or 0) < (fresh["insulin"].get("units") or 0)


def test_falling_sugar_is_never_called_a_spike(monkeypatch):
    plan = plan_for(monkeypatch, PROFILES["type2_tablets"], SUGARS["falling"], [], [])
    assert plan["forecast"]["direction"] != "up" and plan["forecast"]["alert"] != "high"
