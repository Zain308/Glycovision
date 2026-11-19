"""
Stress over time (services/stress_pattern.py): ongoing-stress detection,
the personal stress-to-sugar effect, and the rule that none of it ever
touches a dose.
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import stress_pattern as sp

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)


def check(days_ago, level, hour=0):
    return {"time": NOW - timedelta(days=days_ago, hours=hour), "level": level, "basis": "personal_baseline"}


# ---------------------------------------------------------------- pattern

def test_too_few_checks():
    r = sp.summarise_pattern([check(0, "elevated"), check(1, "elevated")], NOW)
    assert r["status"] == "not_enough_checks"


def test_ongoing_needs_three_days_and_half_the_checks():
    checks = [check(0, "elevated"), check(2, "possible"), check(4, "elevated"), check(5, "calm")]
    r = sp.summarise_pattern(checks, NOW)
    assert r["status"] == "ongoing" and r["stressed_days"] == 3


def test_many_checks_on_one_day_is_not_ongoing():
    checks = [check(0, "elevated", h) for h in range(4)] + [check(3, "calm")]
    assert sp.summarise_pattern(checks, NOW)["status"] == "some"


def test_three_days_but_mostly_calm_is_not_ongoing():
    checks = [check(d, "possible") for d in (0, 2, 4)] + [check(d, "calm", 1) for d in range(6)]
    assert sp.summarise_pattern(checks, NOW)["status"] == "some"


def test_old_checks_are_ignored():
    checks = [check(d, "elevated") for d in (8, 9, 10, 11)] + [check(0, "calm"), check(1, "calm"), check(2, "calm")]
    assert sp.summarise_pattern(checks, NOW)["status"] == "calm"


# ---------------------------------------------------------------- rise after a check

def row(minutes, **kw):
    return {"_t": NOW + timedelta(minutes=minutes), **kw}


def test_rise_uses_reading_before_and_peak_after():
    readings = [row(-20, value=130), row(-5, value=140), row(90, value=170), row(150, value=185)]
    assert sp.glucose_rise_after(NOW, readings, [], []) == 45


@pytest.mark.parametrize("table", ["meals", "doses"])
def test_meal_or_insulin_in_window_skips_the_check(table):
    readings = [row(-5, value=140), row(90, value=200)]
    other = [row(30)]
    meals, doses = (other, []) if table == "meals" else ([], other)
    assert sp.glucose_rise_after(NOW, readings, meals, doses) is None


def test_missing_before_or_after_reading():
    assert sp.glucose_rise_after(NOW, [row(90, value=200)], [], []) is None
    assert sp.glucose_rise_after(NOW, [row(-5, value=140)], [], []) is None


def test_bad_values_are_skipped():
    assert sp.glucose_rise_after(NOW, [row(-5, value=0), row(90, value=200)], [], []) is None


# ---------------------------------------------------------------- effect

def test_effect_needs_three_of_each():
    r = sp.summarise_effect([("elevated", 40)] * 3 + [("calm", 5)] * 2)
    assert r["status"] == "learning" and r["difference_mg_dl"] is None


def test_stress_raises_sugar():
    r = sp.summarise_effect([("elevated", 50), ("possible", 40), ("elevated", 45), ("calm", 10), ("calm", 0), ("calm", 5)])
    assert r["status"] == "raises" and r["difference_mg_dl"] == 40


def test_stress_lowers_sugar_is_reported():
    r = sp.summarise_effect([("elevated", -30)] * 3 + [("calm", 5)] * 3)
    assert r["status"] == "lowers"
    assert "lows" in r["summary"]


def test_small_difference_is_no_clear_effect():
    r = sp.summarise_effect([("elevated", 15)] * 3 + [("calm", 5)] * 3)
    assert r["status"] == "no_clear_effect"


# ---------------------------------------------------------------- end to end with the fake DB

def iso(dt):
    return dt.isoformat()


def test_get_stress_pattern_end_to_end(monkeypatch, fake_db):
    now = datetime.now(timezone.utc)
    stress_logs, bg = [], []
    # 3 stressed checks (single recording score 0.8 -> "possible") and 3 calm ones,
    # each on its own day, with a reading before and after.
    for i, score in enumerate([0.8, 0.8, 0.8, 0.2, 0.2, 0.2]):
        t = now - timedelta(days=i, hours=4)
        stress_logs.append({"user_id": "u1", "acoustic_score": score, "quality": "good",
                            "model_status": "x", "logged_at": iso(t)})
        rise = 50 if score > 0.5 else 5
        bg += [{"user_id": "u1", "value": 120, "logged_at": iso(t - timedelta(minutes=5))},
               {"user_id": "u1", "value": 120 + rise, "logged_at": iso(t + timedelta(minutes=120))}]
    fake_db.rows.update({"stress_logs": stress_logs, "bg_readings": bg, "meals": [], "bolus_logs": []})
    monkeypatch.setattr(sp, "get_db", lambda: fake_db)
    monkeypatch.setattr(sp, "get_saved_baseline", lambda user_id: None)

    r = sp.get_stress_pattern("u1")
    assert r["pattern"]["status"] == "ongoing"
    assert r["effect"]["status"] == "raises" and r["effect"]["difference_mg_dl"] == 45
    assert "never changes an insulin dose" in r["disclaimer"]
    assert any("doctor" in tip for tip in r["advice"])


def test_advice_never_tells_patient_to_add_units():
    pattern = {"status": "ongoing"}
    for status in ("raises", "lowers", "no_clear_effect", "learning"):
        tips = " ".join(sp.build_advice(pattern, {"status": status})).lower()
        assert "take extra" not in tips and "increase your dose" not in tips


def test_endpoint_requires_login_and_returns_data(client, monkeypatch):
    import routers.stress as router
    monkeypatch.setattr(router, "get_stress_pattern", lambda uid: {"pattern": {"status": "calm"}})
    r = client.get("/api/v1/stress-pattern")
    assert r.status_code == 200 and r.json()["pattern"]["status"] == "calm"
