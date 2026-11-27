"""
Fitness: Move Minutes, Heart Points, sitting, verdicts, sleep and vitals.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from services import fitness as fit
from services import fitness_store as store

DAY = datetime(2026, 11, 22, 19, 0, tzinfo=timezone.utc)      # midnight in Pakistan
END = DAY + timedelta(days=1)
TODAY = date(2026, 11, 23)


def at(hour, minute=0):
    return DAY + timedelta(hours=hour, minutes=minute)


def walk(hour, buckets, steps=550):
    return {at(hour, 5 * i): steps for i in range(buckets)}


# ------------------------------------------------------- points and minutes

@pytest.mark.parametrize("steps,hr,age,points", [
    (499, None, 40, 0), (500, None, 40, 5), (650, None, 40, 10),
    (650, None, 70, 5),            # 130 a minute is not "vigorous" over 60
    (200, 130, 40, 10),            # 72 % of 180 while moving
    (200, 100, 40, 5),             # 56 %
    (0, 150, 40, 0),               # fast heart at rest: stress, not exercise
    (200, 150, None, 0),           # age unknown: no maximum heart rate
])
def test_heart_points(steps, hr, age, points):
    assert fit.bucket_activity(steps, hr, age)[1] == points


def test_minute_data_from_the_phone_is_used_when_sent():
    assert fit.bucket_activity(330, None, 30, move=3, cadence_points=3) == (3, 3)
    assert fit.bucket_activity(0, None, 30) == (0, 0)


def test_day_totals():
    s = {"steps": {**walk(9, 6), at(15): 60}, "heart_rate": {at(9): 110, at(12): 62, at(13): 60}}
    m = fit.day_metrics(s, [], DAY, END, age=30, weight_kg=70, height_cm=170)
    assert m["steps"] == 3360 and m["heart_pts"] == 30 and m["active_hours"] == 1
    assert m["hourly"][9] == 3300 and m["hourly"][15] == 60
    assert m["distance_estimated"] and m["distance_m"] == round(3360 * 0.7038)
    assert m["kcal_estimated"] and 50 < m["active_kcal"] < 100


def test_no_data_is_unknown_not_zero():
    m = fit.day_metrics({}, [], DAY, END)
    assert m["steps"] is None and m["move_min"] is None and m["longest_sit_min"] is None


def session(activity, start, minutes, **kw):
    return {"activity": activity, "start": start, "end": start + timedelta(minutes=minutes), **kw}


def test_a_typed_walk_is_not_counted_twice():
    s = {"steps": walk(9, 6)}
    alone = fit.day_metrics(s, [], DAY, END, age=30)
    typed = fit.day_metrics(s, [session("Walking", at(9), 30)], DAY, END, age=30)
    assert typed["move_min"] == alone["move_min"] and typed["heart_pts"] == alone["heart_pts"]


def test_cycling_without_steps_is_added():
    m = fit.day_metrics({"steps": {at(9): 10}}, [session("Cycling", at(17), 30)], DAY, END, weight_kg=70)
    assert m["move_min"] == 30 and m["heart_pts"] == 30 and m["active_kcal"] == 175


def test_stretching_moves_but_earns_no_heart_points():
    m = fit.day_metrics({}, [session("Stretching", at(17), 10)], DAY, END)
    assert m["move_min"] == 10 and m["heart_pts"] == 0 and m["steps"] is None


def test_same_workout_from_watch_and_phone_counts_once():
    m = fit.day_metrics({}, [session("Cycling", at(17), 30), session("Cycling", at(17, 2), 28)], DAY, END)
    assert m["move_min"] == 30


def test_session_over_midnight_is_cut():
    m = fit.day_metrics({}, [session("Cycling", DAY - timedelta(minutes=20), 30)], DAY, END)
    assert m["move_min"] == 10


# ------------------------------------------------------- sitting

def test_longest_sit_between_8_and_22():
    s = {at(8): 100, at(9): 100, at(13): 100}
    assert fit.longest_sit(s, DAY, at(14)) == 235             # 9:05 to 13:00
    assert fit.longest_sit({at(3): 500}, DAY, at(7)) == 0     # sleeping time


def test_sitting_now_needs_a_fresh_sync():
    s = {at(10): 100}
    assert fit.sitting_now(s, DAY, at(12), at(11, 55)) == 115
    assert fit.sitting_now(s, DAY, at(12), at(10, 5)) is None
    assert fit.sitting_now(s, DAY, at(23), at(22, 55)) is None
    assert fit.sitting_now({}, DAY, at(12), at(12)) is None
    assert fit.sitting_now({at(10): 100, at(11, 50): 3}, DAY, at(12), at(11, 55)) == 115   # 3 steps isn't a break


# ------------------------------------------------------- verdicts

@pytest.mark.parametrize("steps,points,hour,level", [
    (None, None, 12, "unknown"), (9000, 0, 12, "active"), (3000, 30, 12, "active"), (100, 0, 8.5, "early"),
    (4000, 0, 14, "on_track"), (2200, 0, 14, "low"), (600, 0, 18, "sitting"), (600, 20, 18, "on_track"),
])
def test_day_status(steps, points, hour, level):
    r = fit.day_status({"steps": steps, "heart_pts": points, "move_min": 0}, hour, 8000, None)
    assert r["level"] == level


def days(*points, steps=6000):
    return [{"day": TODAY - timedelta(days=i), "heart_pts": p, "steps": steps if p is not None else None} for i, p in enumerate(points)]


@pytest.mark.parametrize("points,level", [
    ((30, 30, 30, 30, 30, 0, 0), "active"), ((20, 20, 20, 20, 0, 0, 0), "some"), ((5, 5, 5, 5, 5, 5, 5), "inactive"),
    ((30, 30), "learning"), ((None,) * 7, "learning"),
])
def test_week_status(points, level):
    assert fit.week_status(days(*points), 150, TODAY)["level"] == level


def test_two_quiet_days_are_mentioned_and_today_is_not_counted():
    assert fit.week_status(days(0, 0, 0, 40, 40, 40, 40), 150, TODAY)["quiet_days"] == 2
    assert "2 full days" in fit.week_status(days(0, 0, 0, 40, 40, 40, 40), 150, TODAY)["text"]
    assert fit.week_status(days(0, 40, 40, 40, 40, 0, 0), 150, TODAY)["quiet_days"] == 0


def test_a_week_without_activity_is_counted():
    assert fit.week_status(days(0, 0, 0, 0, 0, 0, 0), 150, TODAY)["quiet_days"] == 6
    assert fit.week_status(days(40, 0, 0, 0, 0, 0, 0), 150, TODAY)["quiet_days"] == 0


def test_days_outside_the_week_do_not_count():
    old = [{"day": TODAY - timedelta(days=9), "heart_pts": 500, "steps": 9000}]
    assert fit.week_status(days(1, 1, 1, 1) + old, 150, TODAY)["heart_pts"] == 4


def test_streak():
    rows = [{"day": TODAY - timedelta(days=i), "steps": s} for i, s in enumerate((1000, 9000, 8500, 8000, 100, 9000))]
    assert fit.streak(rows, 8000, TODAY) == 3
    rows[0]["steps"] = 8000
    assert fit.streak(rows, 8000, TODAY) == 4
    assert fit.streak([], 8000, TODAY) == 0


def effect_days(quiet, busy, n=5):
    rows = [{"day": TODAY - timedelta(days=i), "steps": 2000 + i if i < n else 9000 + i} for i in range(2 * n)]
    sugar = {r["day"]: [quiet if i < n else busy] * 2 for i, r in enumerate(rows)}
    return fit.sugar_effect(rows, sugar, 8000)


def test_sugar_effect():
    assert effect_days(160, 130)["status"] == "lower" and effect_days(160, 130)["difference"] == -30
    assert effect_days(130, 160)["status"] == "higher" and "doctor" in effect_days(130, 160)["text"]
    assert effect_days(140, 138)["status"] == "same"
    assert effect_days(160, 130, n=3)["status"] == "learning"


# ------------------------------------------------------- sleep and vitals

def test_sleep_counts_one_night_once_and_removes_awake_time():
    now = at(9)
    a = {"start": at(0), "end": at(7), "awake_min": 30, "deep_min": 60}
    b = {"start": at(0, 10), "end": at(6, 50)}
    r = fit.sleep_summary([a, b], [], now)
    assert r["minutes"] == 390 and r["level"] == "fair" and r["deep_min"] == 60
    typed = fit.sleep_summary([], [{"value": 7.5, "time": at(8)}], now)
    assert typed["minutes"] == 450 and typed["source"] == "manual"
    assert fit.sleep_summary([], [], now) is None


@pytest.mark.parametrize("s,d,level", [
    (115, 75, "normal"), (124, 78, "elevated"), (132, 78, "raised"), (118, 82, "raised"), (145, 85, "high"),
    (185, 100, "urgent"), (150, 121, "urgent"), (85, 55, "low"),
])
def test_blood_pressure(s, d, level):
    assert fit.blood_pressure_level(s, d)[0] == level


# ------------------------------------------------------- API

def test_fitness_works_before_the_database_update(client, monkeypatch):
    def broken():
        raise RuntimeError("relation does not exist")
    monkeypatch.setattr(store, "get_profile_row", lambda db, uid: None)
    calls = {"n": 0}

    def db():
        calls["n"] += 1
        if calls["n"] == 1:
            return None
        return broken()
    monkeypatch.setattr(store, "get_db", db)
    r = client.get("/api/v1/fitness")
    assert r.status_code == 200
    body = r.json()
    assert body["status"]["level"] == "unknown" and body["week"]["level"] == "learning" and len(body["days"]) == 30


def test_fitness_day_is_built_from_rows(monkeypatch, fake_db):
    now = datetime.now(timezone.utc)
    tz = ZoneInfo("Asia/Karachi")
    start, _ = store.day_bounds(fit.local_day(now, tz), tz)
    t = start.isoformat()
    fake_db.rows = {
        "profiles": [{"id": "u1", "timezone": "Asia/Karachi", "birth_year": 1990, "weight_kg": 70, "height_cm": 170}],
        "health_samples": [{"user_id": "u1", "kind": "steps", "bucket_start": t, "value": 600}],
        "vitals": [{"id": 1, "user_id": "u1", "kind": "blood_pressure", "value": 150, "value2": 95, "logged_at": now.isoformat()},
                   {"id": 2, "user_id": "u1", "kind": "weight", "value": 70, "logged_at": now.isoformat()}],
        "health_daily": [{"user_id": "u1", "day": (fit.local_day(now, tz) - timedelta(days=1)).isoformat(), "steps": 9000, "heart_pts": 40}],
    }
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    r = store.build_fitness("u1")
    assert r["today"]["steps"] == 600 and r["days"][-1]["steps"] == 600 and r["days"][-2]["steps"] == 9000
    assert r["vitals"]["blood_pressure"]["level"] == "high" and r["weight_history"][0]["value"] == 70
    assert r["streak"] == 1


@pytest.mark.parametrize("body", [
    {"kind": "weight", "value": 5}, {"kind": "blood_pressure", "value": 120}, {"kind": "blood_pressure", "value": 80, "value2": 120},
    {"kind": "hba1c", "value": 50}, {"kind": "sleep", "value": 30}, {"kind": "mood", "value": 5},
])
def test_bad_vitals_rejected(client, body):
    assert client.post("/api/v1/vitals", json=body).status_code == 422


def test_weight_updates_the_profile(monkeypatch, fake_db):
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    store.save_vitals("u1", [{"kind": "weight", "value": 71.26, "time": at(9)}], "manual")
    assert ("profiles", {"weight_kg": 71.3}) in fake_db.writes


def test_phone_totals_never_replace_computed_days(monkeypatch, fake_db):
    fake_db.rows = {"health_daily": [{"user_id": "u1", "day": "2026-11-10", "steps": 5000, "heart_pts": 12}]}
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    n = store.save_day_totals("u1", [{"day": date(2026, 11, d), "steps": 100.0} for d in (10, 11, 22)], date(2026, 11, 21))
    assert n == 1 and fake_db.writes[0][1][0]["day"] == "2026-11-11"


@pytest.mark.parametrize("method,path", [("get", "/api/v1/fitness"), ("delete", "/api/v1/vitals/1"), ("delete", "/api/v1/activity/1")])
def test_fitness_routes_need_login(anon_client, method, path):
    assert getattr(anon_client, method)(path).status_code in (401, 403)
