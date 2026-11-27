"""
The supervisor's flow: forecast -> insulin -> activity, plus body metrics,
health data and the stress gauge. The dose rules are the critical part.
"""

import itertools
from datetime import datetime, timedelta, timezone

import pytest

from services import care_plan as cp
from services import glucose_forecast as gf
from services import health_data as hd
from services import stress_fusion as sf
from services.activity_advice import activity_plan
from services.body_metrics import bmi_group, body_metrics
from services.dose_simulator import carb_fraction_absorbed, check_dose, lowest, simulate

NOW = datetime(2026, 11, 23, 9, 0, tzinfo=timezone.utc)
PROFILE = {"mealtime_insulin": True, "insulin_type": "rapid", "icr": 10, "isf": 50, "target_bg": 110,
           "dia_hours": 4, "diabetes_type": "Type 1"}


def ctx(meals=(), doses=()):
    return {
        "meals": [{"food_name": "Biryani", "carbs": c, "_t": NOW - timedelta(minutes=m)} for c, m in meals],
        "doses": [{"dose_units": u, "_t": NOW - timedelta(minutes=m)} for u, m in doses],
        "readings": [], "hour": 13.0,
        "wearable": {"hr_15m": None, "hr_60m": None, "steps_15m": None, "steps_60m": None},
    }


def fc(bg=150, low=0.02, spike=0.2, change=10):
    return {"status": "ready", "current_bg": bg, "low_probability": low, "spike_probability": spike, "change_60": change}


# ------------------------------------------------------- dose simulation

def test_carbs_absorb_fully_and_in_order():
    vals = [carb_fraction_absorbed(t) for t in range(0, 200, 5)]
    assert vals[0] == 0 and vals[-1] == 1 and vals == sorted(vals)


def test_formula_dose_lands_on_target():
    r = check_dose(6.8, 150, 50, 10, 4, meals=[(60, 0)])
    assert r["units"] == 6.8 and r["end_with"] == 110 and not r["lowered"]


def test_active_insulin_lowers_a_correction():
    r = check_dose(2.0, 210, 50, 10, 4, doses=[(4, 90)])
    assert r["units"] < 2.0 and r["lowest_with"] >= 80


def test_start_between_70_and_80_still_covers_the_meal():
    """Regression: the first version withheld all insulin here (sugar -> 375)."""
    r = check_dose(6.0, 75, 50, 10, 4, meals=[(60, 0)])
    assert r["units"] >= 5.5 and r["end_with"] >= 80 and r["peak_with"] < 180


def test_simulation_never_raises_the_dose_and_never_causes_a_low():
    for bg, carbs, formula, isf, icr, dia, active in itertools.product(
        (70, 79, 80, 180, 450), (0, 15, 150), (0.5, 3, 15), (15, 50, 120), (5, 25), (3, 6), (0, 6)
    ):
        doses = [(active, 60)] if active else []
        meals = [(carbs, 0)] if carbs else []
        r = check_dose(formula, bg, isf, icr, dia, doses, meals)
        assert 0 <= r["units"] <= formula
        if r["units"] > 0:
            path = simulate(bg, isf, icr, dia, doses, meals, r["units"])
            assert lowest(path) >= 70 - 1e-6, (bg, carbs, formula, isf, icr, dia, active)
            assert path[-1]["bg"] >= 80 - 1e-6


def test_one_hour_is_too_short_to_judge_a_dose():
    """2 u at ISF 50 is worth 100 mg/dL, but only ~26 of it in the first hour."""
    path = simulate(250, 50, 10, 4, new_dose=2)
    assert 220 < path[12]["bg"] < 226 and round(path[-1]["bg"]) == 150


# ------------------------------------------------------- insulin plan

def test_dose_for_an_uncovered_meal():
    r = cp.insulin_plan(PROFILE, fc(150), ctx(meals=[(60, 5)]), NOW)
    assert r["status"] == "dose" and 0 < r["units"] <= 6.8
    assert r["meal_name"] == "Biryani" and "10 to 20 minutes" in r["message"]


def test_meal_already_dosed_is_not_dosed_again():
    r = cp.insulin_plan(PROFILE, fc(110), ctx(meals=[(60, 20)], doses=[(6, 18)]), NOW)
    assert r["units"] == 0 and r["carbs"] == 0


def test_pending_meal_carbs_are_used():
    r = cp.insulin_plan(PROFILE, fc(110), ctx(), NOW, carbs=30)
    assert r["status"] == "dose" and r["units"] == 3.0


@pytest.mark.parametrize("change,status", [
    ({"mealtime_insulin": False}, "not_needed"),
    ({"diabetes_type": "No diabetes"}, "not_needed"),
    ({"mealtime_insulin": None}, "setup"),
    ({"insulin_type": None}, "setup"),
    ({"insulin_type": "premixed"}, "unsupported"),
    ({"insulin_type": "regular"}, "unsupported"),
    ({"icr": None}, "setup"),
    ({"isf": 500}, "setup"),
])
def test_no_dose_without_the_right_profile(change, status):
    r = cp.insulin_plan({**PROFILE, **change}, fc(200), ctx(meals=[(60, 5)]), NOW)
    assert r["status"] == status and not r.get("units")


def test_low_now_blocks_insulin():
    r = cp.insulin_plan(PROFILE, fc(65), ctx(meals=[(60, 5)]), NOW)
    assert r["status"] == "blocked_low" and r["units"] == 0


def test_likely_low_holds_a_correction():
    r = cp.insulin_plan(PROFILE, fc(200, low=0.35), ctx(), NOW)
    assert r["status"] == "hold" and r["units"] == 0


def test_stale_reading_gives_no_dose():
    r = cp.insulin_plan(PROFILE, {"status": "stale", "message": "old"}, ctx(meals=[(60, 5)]), NOW)
    assert r["status"] == "need_reading"


def test_dose_ignores_stress_and_spike_probability():
    """Nothing predicted by AI may change the units, only block them."""
    a = cp.insulin_plan(PROFILE, fc(180, spike=0.05, change=-10), ctx(meals=[(40, 5)]), NOW)
    b = cp.insulin_plan(PROFILE, fc(180, spike=0.95, change=90), ctx(meals=[(40, 5)]), NOW)
    assert a["units"] == b["units"]


# ------------------------------------------------------- activity

def test_no_exercise_when_low_or_very_high():
    assert activity_plan(bg=65)["status"] == "blocked"
    assert activity_plan(bg=320)["status"] == "blocked"
    assert activity_plan(bg=65)["options"] == []


def test_snack_and_gentle_below_100_for_insulin_users():
    r = activity_plan(bg=95, on_insulin=True)
    assert r["status"] == "caution" and any("15 g" in s for s in r["safety"])
    assert all(o["intensity"] != "Moderate" for o in r["options"])


def test_ketone_check_above_250():
    r = activity_plan(bg=270, on_insulin=True, change_60=30)
    assert any("ketones" in s for s in r["safety"]) and all(o["intensity"] != "Moderate" for o in r["options"])


def test_insulin_and_hard_exercise_are_never_combined():
    for kw in ({"dose_suggested": 3}, {"iob": 2}):
        r = activity_plan(bg=200, on_insulin=True, change_60=50, **kw)
        assert all(o["intensity"] != "Moderate" for o in r["options"])


def test_rise_suggests_a_walk_with_calories():
    r = activity_plan(bg=160, on_insulin=False, change_60=45, weight_kg=70)
    assert r["options"][0]["key"] == "walk_brisk" and r["options"][0]["kcal"] == round(4.3 * 70 / 4)


def test_night_is_stretching_only():
    r = activity_plan(bg=180, hour=23, change_60=60)
    assert {o["key"] for o in r["options"]} <= {"stretch", "breathe"}


def test_insulin_user_without_reading_must_check_first():
    assert activity_plan(bg=None, on_insulin=True)["status"] == "need_reading"
    assert activity_plan(bg=None, on_insulin=False)["status"] == "go"


# ------------------------------------------------------- body metrics

def test_bmi_and_bmr():
    r = body_metrics({"height_cm": 170, "weight_kg": 70, "sex": "male", "birth_year": datetime.now().year - 30}, 8000)
    assert r["bmi"] == 24.2 and r["bmi_label"] == "Overweight"      # Asian cutoff 23
    assert r["bmr_kcal"] == 1618 and r["daily_kcal"] == round(1617.5 * 1.55)


@pytest.mark.parametrize("bmi,group", [(18.4, "underweight"), (18.5, "healthy"), (22.9, "healthy"), (23, "overweight"), (27.4, "overweight"), (27.5, "obese")])
def test_bmi_groups(bmi, group):
    assert bmi_group(bmi)[0] == group


def test_children_get_no_adult_groups():
    r = body_metrics({"height_cm": 140, "weight_kg": 35, "sex": "female", "birth_year": datetime.now().year - 11})
    assert r["bmi"] and r["bmi_group"] is None and r["bmr_kcal"] is None


def test_missing_body_details():
    r = body_metrics({})
    assert r["bmi"] is None and set(r["missing"]) == {"height_cm", "weight_kg", "sex", "birth_year"}


# ------------------------------------------------------- health data

def test_samples_merge_into_buckets():
    t = datetime(2026, 11, 23, 9, 2, tzinfo=timezone.utc)
    rows = hd.merge_samples([
        {"kind": "steps", "time": t, "value": 30}, {"kind": "steps", "time": t + timedelta(minutes=1), "value": 20},
        {"kind": "heart_rate", "time": t, "value": 80}, {"kind": "heart_rate", "time": t + timedelta(minutes=2), "value": 90},
        {"kind": "steps", "time": t + timedelta(minutes=5), "value": 7},
    ])
    assert [(r["kind"], r["value"]) for r in rows] == [("heart_rate", 85), ("steps", 50), ("steps", 7)]
    assert rows[1]["bucket_start"] == "2026-11-23T09:00:00+00:00"


def test_missing_tables_are_tolerated(monkeypatch):
    def broken():
        raise RuntimeError("relation does not exist")
    monkeypatch.setattr(hd, "get_db", broken)
    assert hd.wearable_features("u1", NOW)["steps_60m"] is None
    assert hd.today_summary("u1", NOW)["connected"] is False


def test_sync_filters_bad_samples(client, monkeypatch, fake_db):
    import routers.health as health_router
    from services import fitness_store
    for module in (hd, health_router, fitness_store):
        monkeypatch.setattr(module, "get_db", lambda: fake_db)
    now = datetime.now(timezone.utc)
    r = client.post("/api/v1/health-sync", json={"samples": [
        {"kind": "heart_rate", "time": now.isoformat(), "value": 72},
        {"kind": "heart_rate", "time": now.isoformat(), "value": 400},
        {"kind": "steps", "time": (now - timedelta(days=30)).isoformat(), "value": 50},
        {"kind": "steps", "time": (now + timedelta(hours=3)).isoformat(), "value": 50},
    ]})
    assert r.status_code == 200 and r.json() == {"status": "saved", "buckets": 1, "extras": 0, "glucose": 0, "ignored": 3}
    assert fake_db.writes[0][0] == "health_samples"


@pytest.mark.parametrize("path", ["/api/v1/care-plan", "/api/v1/stress-gauge", "/api/v1/activity-today", "/api/v1/body-metrics"])
def test_health_routes_need_login(anon_client, path):
    assert anon_client.get(path).status_code in (401, 403)


@pytest.mark.parametrize("body", [{"activity": "Walk", "minutes": 0}, {"activity": "", "minutes": 10}, {"activity": "Walk", "minutes": 9999}])
def test_bad_activity_rejected(client, body):
    assert client.post("/api/v1/log-activity", json=body).status_code == 422


# ------------------------------------------------------- stress gauge

def test_fast_heart_while_walking_is_not_stress():
    assert sf.heart_sign(125, 70, 600)[0] == "moving"
    assert sf.fuse("calm", "moving") == ("calm", "voice")


@pytest.mark.parametrize("hr,sign", [(80, "normal"), (86, "raised"), (96, "high")])
def test_heart_sign_at_rest(hr, sign):
    assert sf.heart_sign(hr, 70, 10)[0] == sign


@pytest.mark.parametrize("voice,sign,level", [
    (None, "unknown", None), (None, "high", "possible"), ("calm", "normal", "calm"), ("calm", "high", "possible"),
    ("possible", "high", "elevated"), ("elevated", "unknown", "elevated"), ("elevated", "normal", "possible"), ("elevated", "raised", "elevated"),
])
def test_fusion(voice, sign, level):
    assert sf.fuse(voice, sign)[0] == level


# ------------------------------------------------------- forecast (real model)

model = pytest.mark.skipif(not (gf.MODEL_DIR / "forecast.joblib").exists(), reason="forecast model not trained")


def live_ctx(readings, meals=(), doses=()):
    c = ctx(meals, doses)
    c["readings"] = [{"value": v, "time": NOW - timedelta(minutes=m)} for v, m in readings]
    return c


@model
@pytest.mark.parametrize("readings", [
    [(140, 0)], [(140, 0), (120, 28)], [(140, 0), (130, 15), (120, 30), (110, 60)],
    [(140 - 2 * m // 5, m) for m in range(0, 65, 5)],
])
def test_forecast_shape_and_bounds(readings):
    r = gf.forecast_from_context(live_ctx(readings), NOW)
    assert r["status"] == "ready" and [p["minute"] for p in r["points"]] == list(range(0, 61, 5))
    assert r["points"][0]["mid"] == 140
    for p in r["points"]:
        assert 40 <= p["low"] <= p["mid"] <= p["high"] <= 400
    assert 0 <= r["spike_probability"] <= 1 and 0 <= r["low_probability"] <= 1


@model
def test_more_readings_give_a_narrower_range():
    one = gf.forecast_from_context(live_ctx([(140, 0)]), NOW)["range_60"]
    many = gf.forecast_from_context(live_ctx([(140, m) for m in range(0, 65, 5)]), NOW)["range_60"]
    assert many[1] - many[0] < one[1] - one[0]


@model
def test_rising_is_forecast_higher_than_falling():
    up = gf.forecast_from_context(live_ctx([(150 - m, m) for m in range(0, 65, 5)]), NOW)
    down = gf.forecast_from_context(live_ctx([(150 + m, m) for m in range(0, 65, 5)]), NOW)
    assert up["change_60"] > down["change_60"]


@model
def test_direction_agrees_with_the_warning():
    """Regression: the card said 'spike likely' above the word 'steady'."""
    up = gf.forecast_from_context(live_ctx([(168, 0), (150, 15), (138, 30), (122, 60)], meals=[(34, 12)]), NOW)
    down = gf.forecast_from_context(live_ctx([(84, 0), (101, 15), (118, 30), (140, 60)]), NOW)
    for r, p, d in ((up, "spike_probability", "up"), (down, "low_probability", "down")):
        assert r[p] < gf.LIKELY or r["direction"] == d


def test_one_reading_never_reassures():
    level, title, _ = gf.alert_level(
        132, {"low_probability": 0.02, "spike_probability": 0.1, "change_60": 1, "based_on": "single"})
    assert level == "watch" and "steady" not in title.lower()
    r = activity_plan(bg=132, on_insulin=True, change_60=None)
    assert "looks steady" not in r["why"] and all(o["intensity"] != "Moderate" for o in r["options"])


def test_tiny_dose_is_not_suggested():
    r = cp.insulin_plan(PROFILE, fc(130), ctx(), NOW)
    assert r["status"] == "none_needed" and r["units"] == 0


def test_stale_and_empty():
    assert gf.forecast_from_context(live_ctx([]), NOW)["status"] == "no_reading"
    assert gf.forecast_from_context(live_ctx([(140, 40)]), NOW)["status"] == "stale"


def test_low_now_is_urgent():
    assert gf.alert_level(65, {"low_probability": 0.1, "spike_probability": 0.1, "change_60": 5})[0] == "urgent"


def test_change_is_rescaled_to_the_lag():
    f = gf.glucose_features([{"value": 144, "time": NOW}, {"value": 122, "time": NOW - timedelta(minutes=22)}], NOW)
    assert f["delta_20"] == pytest.approx(20)


# ------------------------------------------------------- Bolus screen and voice guard

def _calc(monkeypatch, profile, context):
    import models.schemas as ms
    from services.bolus_engine import calculate_safe_bolus
    monkeypatch.setattr(cp, "get_db", lambda: None)
    monkeypatch.setattr(cp, "get_profile_row", lambda db, uid: profile)
    monkeypatch.setattr(cp, "load_context", lambda uid, now, p: context)
    monkeypatch.setattr(cp.health_data, "manual_activity", lambda uid, since: [])
    state = ms.PatientState(current_bg=210, target_bg=110, isf=50, iob=0, total_carbs=0, icr=10)
    result = calculate_safe_bolus(state)
    cp.test_calculator_dose("u1", state, result)
    return result


def test_bolus_screen_dose_is_lowered_by_logged_insulin(monkeypatch):
    now = datetime.now(timezone.utc)
    r = _calc(monkeypatch, PROFILE, {"doses": [{"dose_units": 4, "_t": now - timedelta(minutes=90)}], "meals": []})
    assert r.recommended_total_dose_units < 2.0 and any("Lowered" in f for f in r.safety_flags)


@pytest.mark.parametrize("change", [{"mealtime_insulin": False}, {"insulin_type": "premixed"}, {"diabetes_type": "No diabetes"}])
def test_bolus_screen_respects_the_profile(monkeypatch, change):
    r = _calc(monkeypatch, {**PROFILE, **change}, {"doses": [], "meals": []})
    assert r.recommended_total_dose_units == 0


def test_bolus_screen_unchanged_for_profiles_not_filled_in_yet(monkeypatch):
    r = _calc(monkeypatch, {}, {"doses": [], "meals": []})
    assert r.recommended_total_dose_units == 2.0


@pytest.mark.parametrize("f0,expected", [(120, True), (140, True), (220, False), (0, False), (None, False)])
def test_automatic_clip_must_sound_like_the_user(monkeypatch, f0, expected):
    from services import voice_deviation as vd
    monkeypatch.setattr(vd, "get_saved_baseline", lambda user_id: {"f0_mean_median": 120})
    assert vd.is_probably_user("u1", f0) is expected


def test_automatic_clip_needs_a_baseline(monkeypatch):
    from services import voice_deviation as vd
    monkeypatch.setattr(vd, "get_saved_baseline", lambda user_id: None)
    assert vd.is_probably_user("u1", 120) is False


# ------------------------------------------------------- inputs really drive the outputs

TREND = [(168, 0), (150, 15), (138, 30), (122, 60)]


@model
@pytest.mark.parametrize("readings", [TREND, [(110, 0)], [(150, 0), (150, 30)], [(200, 0), (200, 15), (200, 30), (200, 60)]])
def test_more_food_always_means_more_sugar(readings):
    """Regression: the first model gave +15 for 15 g of carbs and +6 for 90 g."""
    rs = [gf.forecast_from_context(live_ctx(readings), NOW, carbs) for carbs in (0, 15, 30, 60, 90, 150)]
    for key in ("change_60", "spike_probability"):
        values = [r[key] for r in rs]
        assert values == sorted(values) and values[-1] > values[0]
    assert all(a["range_60"][1] <= b["range_60"][1] for a, b in zip(rs, rs[1:]))


@model
def test_more_active_insulin_always_means_less_sugar():
    rs = [gf.forecast_from_context(live_ctx([(180, 0)], doses=[(u, 5)] if u else []), NOW) for u in (0, 1, 3, 6)]
    changes = [r["change_60"] for r in rs]
    assert changes == sorted(changes, reverse=True) and changes[-1] < changes[0]
    lows = [r["low_probability"] for r in rs]
    assert lows == sorted(lows)


@model
@pytest.mark.parametrize("stress", [-20, 0, 15])
def test_effects_add_up_to_the_change(stress):
    c = live_ctx(TREND, meals=[(60, 10)], doses=[(2, 30)])
    c["wearable"] = {"hr_15m": 90, "hr_60m": 85, "steps_15m": 300, "steps_60m": 900}
    r = gf.forecast_from_context(c, NOW, profile=PROFILE, stress=stress)
    assert sum(r["effects"].values()) == r["change_60"] and r["effects"]["stress"] == stress


@model
def test_personal_ratios_change_the_food_effect():
    strong = gf.forecast_from_context(live_ctx([(110, 0)], meals=[(60, 5)]), NOW, profile={"isf": 60, "icr": 6})
    weak = gf.forecast_from_context(live_ctx([(110, 0)], meals=[(60, 5)]), NOW, profile={"isf": 30, "icr": 15})
    assert strong["effects"]["food"] > weak["effects"]["food"] > 0


def test_ratios_fall_back_to_body_weight():
    assert gf.personal_ratios({"weight_kg": 72})[1] == 50
    assert gf.personal_ratios(None)[:2] == (gf.CSF_DEFAULT, gf.ISF_DEFAULT)
    assert gf.personal_ratios({"isf": 900, "icr": 1})[0] <= 12


@pytest.mark.parametrize("level,effect,expected", [
    ("calm", {"status": "raises", "difference_mg_dl": 40}, 0),
    (None, {"status": "raises", "difference_mg_dl": 40}, 0),
    ("elevated", {"status": "learning", "difference_mg_dl": None}, 0),
    ("elevated", {"status": "no_clear_effect", "difference_mg_dl": 10}, 0),
    ("elevated", {"status": "raises", "difference_mg_dl": 40}, 20),
    ("possible", {"status": "lowers", "difference_mg_dl": -30}, -15),
    ("elevated", {"status": "raises", "difference_mg_dl": 500}, cp.STRESS_LIMIT),
])
def test_stress_moves_the_forecast_only_from_own_data(monkeypatch, level, effect, expected):
    monkeypatch.setattr(cp, "get_stress_pattern", lambda uid: {"effect": effect})
    assert cp.stress_shift("u1", level) == expected


def test_recent_activity_can_only_lower_the_dose():
    for bg, carbs in itertools.product((75, 95, 130, 220), (0, 30, 90)):
        c = ctx(meals=[(carbs, 5)] if carbs else [])
        rest, moved = (cp.insulin_plan(PROFILE, fc(bg), c, NOW, recently_active=a) for a in (False, True))
        assert (moved.get("units") or 0) <= (rest.get("units") or 0)


def test_recent_activity_minutes():
    log = lambda ago, m: {"activity": "Walk", "minutes": m, "logged_at": (NOW - timedelta(minutes=ago)).isoformat()}
    assert cp.recent_activity_minutes({"manual": [log(30, 20), log(200, 60)]}, {}, NOW) == 20
    assert cp.recent_activity_minutes({"manual": [log(30, 20)]}, {"steps_60m": 3000}, NOW) == 30


def test_planned_meal_is_added_to_a_meal_not_dosed_yet():
    r = cp.insulin_plan(PROFILE, fc(110), ctx(meals=[(40, 10)]), NOW, carbs=30)
    assert r["carbs"] == 70


@pytest.mark.parametrize("isf,weight,warn", [(50, 70, False), (5, 70, True), (200, 70, True), (50, None, False), (None, 70, False)])
def test_sensitivity_is_checked_against_weight(isf, weight, warn):
    assert bool(cp.weight_check(isf, weight)) is warn


def _plan(monkeypatch, context, profile=PROFILE, stress=None, today=None, carbs=None):
    now = datetime.now(timezone.utc)
    for rows in ("meals", "doses"):
        for r in context[rows]:
            r["_t"] += now - NOW
    for r in context["readings"]:
        r["time"] += now - NOW
    monkeypatch.setattr(cp, "get_db", lambda: None)
    monkeypatch.setattr(cp, "get_profile_row", lambda db, uid: profile)
    monkeypatch.setattr(cp, "load_context", lambda uid, n, p: context)
    monkeypatch.setattr(cp.health_data, "today_summary", lambda uid, start: {
        "connected": False, "steps": None, "active_kcal": None, "heart_rate": None, "manual_minutes": 0,
        "manual": [], "last_sync": None, **(today or {})})
    monkeypatch.setattr(cp, "stress_gauge", lambda uid: {"level": stress, "basis": "voice"})
    monkeypatch.setattr(cp, "get_stress_pattern", lambda uid: {"effect": {"status": "raises", "difference_mg_dl": 40}})
    return cp.build_care_plan("u1", carbs)


@model
def test_plan_connects_every_input(monkeypatch):
    r = _plan(monkeypatch, live_ctx(TREND, meals=[(60, 10)], doses=[(1, 100)]), stress="elevated")
    assert [i["key"] for i in r["inputs"]] == ["sugar", "food", "stress", "activity", "body", "insulin"]
    pairs = {(l["from"], l["to"]) for l in r["links"]}
    assert len(pairs) == len(r["links"])
    for i in ("sugar", "food", "stress", "activity", "body"):
        assert {(i, "forecast"), (i, "move")} <= pairs and (i, "insulin") in pairs
    assert sum(r["forecast"]["effects"].values()) == r["forecast"]["change_60"]
    assert r["recheck_minutes"] == 30 and r["events"][0]["kind"] == "food"


@model
def test_stress_link_to_insulin_is_never_used(monkeypatch):
    calm = _plan(monkeypatch, live_ctx(TREND, meals=[(60, 10)]), stress="calm")
    high = _plan(monkeypatch, live_ctx(TREND, meals=[(60, 10)]), stress="elevated")
    assert high["forecast"]["change_60"] > calm["forecast"]["change_60"]
    assert high["insulin"]["units"] == calm["insulin"]["units"]
    for r in (calm, high):
        assert next(l for l in r["links"] if (l["from"], l["to"]) == ("stress", "insulin"))["used"] is False


@model
def test_plan_with_nothing_filled_in(monkeypatch):
    r = _plan(monkeypatch, live_ctx([]), profile={})
    assert not any(i["ready"] for i in r["inputs"]) and not any(l["used"] for l in r["links"] if l["to"] == "forecast")
    assert r["recheck_minutes"] == 0 and r["events"] == []


@model
def test_preview_meal_is_in_the_plan(monkeypatch):
    r = _plan(monkeypatch, live_ctx([(118, 2), (114, 25)]), carbs=60)
    food = next(i for i in r["inputs"] if i["key"] == "food")
    assert food["value"] == "60" and r["insulin"]["carbs"] == 60 and r["forecast"]["effects"]["food"] > 0


# ------------------------------------------------------- people who don't inject at meals

@model
def test_type_2_without_insulin_rises_more_after_food():
    """Regression: type 2 was predicted +7 after meals where the real rise was +46."""
    ctx60 = lambda: live_ctx([(140, 0), (140, 30)], meals=[(60, 0)])
    t2 = gf.forecast_from_context(ctx60(), NOW, profile={"diabetes_type": "Type 2", "mealtime_insulin": False})
    injects = gf.forecast_from_context(ctx60(), NOW, profile={"diabetes_type": "Type 2", "mealtime_insulin": True})
    none = gf.forecast_from_context(ctx60(), NOW, profile={"diabetes_type": "No diabetes"})
    assert t2["effects"]["food"] > none["effects"]["food"] > injects["effects"]["food"]
    assert t2["spike_probability"] > injects["spike_probability"]
    assert sum(t2["effects"].values()) == t2["change_60"]


@pytest.mark.parametrize("profile,share", [
    (None, 0.2), ({"diabetes_type": "Type 1"}, 0.2), ({"diabetes_type": "Type 2"}, 0.5), ({"diabetes_type": "No diabetes"}, 0.3),
    ({"diabetes_type": "Type 2", "mealtime_insulin": True}, 0.2), ({"diabetes_type": "Gestational", "mealtime_insulin": False}, 0.4),
])
def test_food_share(profile, share):
    from services.forecast_features import food_share
    assert food_share(profile) == share


@model
def test_no_food_gives_the_same_forecast_for_everyone():
    a, b = (gf.forecast_from_context(live_ctx(TREND), NOW, profile={"diabetes_type": t}) for t in ("Type 1", "Type 2"))
    assert a["points"] == b["points"]
