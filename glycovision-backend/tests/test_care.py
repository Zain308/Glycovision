"""
Medicines, imported blood sugar, the doctor's report, and the user's own data.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from services import care_store as store
from services import medicines as med
from services import report as rep

TZ = ZoneInfo("Asia/Karachi")
TEST_USER = "00000000-0000-0000-0000-000000000001"      # as in conftest
NOW = datetime(2026, 11, 24, 9, 0, tzinfo=TZ)
M = {"id": 1, "name": "Metformin", "dose": "500 mg", "times": ["08:00", "20:00"], "active": True, "created_at": "2026-11-01T05:00:00+00:00"}


def log(day, time, status="taken", mid=1):
    return {"medicine_id": mid, "day": day, "time": time, "status": status}


# ------------------------------------------------------- medicines

@pytest.mark.parametrize("time,now,status,state", [
    ("08:00", 7 * 60 + 29, None, "later"), ("08:00", 7 * 60 + 30, None, "due"), ("08:00", 10 * 60, None, "due"),
    ("08:00", 10 * 60 + 1, None, "missed"), ("08:00", 23 * 60, "taken", "taken"), ("08:00", 9 * 60, "skipped", "skipped"),
])
def test_dose_state(time, now, status, state):
    assert med.dose_state(time, now, status) == state


def test_today_list_is_in_time_order_and_ignores_stopped_medicines():
    two = {**M, "id": 2, "name": "Aspirin", "times": ["08:00"]}
    stopped = {**M, "id": 3, "active": False}
    r = med.today_list([M, two, stopped], [log("2026-11-24", "08:00"), log("2026-11-23", "20:00")], NOW)
    assert [(d["name"], d["time"], d["state"]) for d in r] == [("Aspirin", "08:00", "due"), ("Metformin", "08:00", "taken"), ("Metformin", "20:00", "later")]


def test_adherence_counts_full_days_only():
    logs = [log(f"2026-11-{d}", "08:00") for d in range(17, 25)] + [log("2026-11-20", "20:00", "skipped")]
    r = med.adherence([M], logs, NOW.date(), TZ)
    assert r["planned"] == 14 and r["taken"] == 7 and r["percent"] == 50


def test_a_new_medicine_is_not_blamed_for_earlier_days():
    r = med.adherence([{**M, "created_at": "2026-11-22T05:00:00+00:00"}], [log("2026-11-23", "08:00")], NOW.date(), TZ)
    assert r["planned"] == 2 and r["taken"] == 1
    assert med.adherence([], [], NOW.date(), TZ)["percent"] is None


@pytest.mark.parametrize("body", [
    {"name": ""}, {"name": "   "}, {"name": "X", "times": ["8:00"]}, {"name": "X", "times": ["25:00"]}, {"name": "X", "times": ["08:00"] * 9},
])
def test_bad_medicines_rejected(client, body):
    assert client.post("/api/v1/medicines", json=body).status_code == 422


def test_another_users_medicine_cannot_be_touched(client, monkeypatch, fake_db):
    fake_db.rows = {"medicines": [{**M, "user_id": "someone-else"}]}
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    import routers.care as care
    monkeypatch.setattr(care, "get_db", lambda: fake_db)
    assert client.put("/api/v1/medicines/1", json={"name": "X"}).status_code == 404
    assert client.delete("/api/v1/medicines/1").status_code == 404
    assert client.post("/api/v1/medicines/1/log", json={"day": date.today().isoformat(), "time": "08:00", "status": "taken"}).status_code == 404
    assert fake_db.writes == []


def test_only_planned_doses_can_be_logged(client, monkeypatch, fake_db):
    fake_db.rows = {"medicines": [{**M, "user_id": TEST_USER}]}
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    import routers.care as care
    monkeypatch.setattr(care, "get_db", lambda: fake_db)
    post = lambda **kw: client.post("/api/v1/medicines/1/log", json={"day": date.today().isoformat(), "time": "08:00", "status": "taken", **kw}).status_code
    assert post() == 200 and post(status=None) == 200
    assert post(time="09:00") == 422 and post(day="2020-01-01") == 422 and post(status="doubled") == 422


# ------------------------------------------------------- imported blood sugar

def at(minute, value, **kw):
    return {"time": NOW + timedelta(minutes=minute), "value": value, **kw}


def test_typed_reading_is_not_imported_again():
    saved = [at(0, 142)]
    assert store.new_readings([at(1, 141)], saved) == []
    assert len(store.new_readings([at(1, 180)], saved)) == 1        # a different value is a different test
    assert len(store.new_readings([at(10, 142)], saved)) == 1
    assert len(store.new_readings([at(5, 100), at(5, 100)], [])) == 1


def test_import_keeps_every_sensor_reading(monkeypatch, fake_db):
    fake_db.rows = {"bg_readings": [
        {"user_id": "u1", "value": 120, "logged_at": NOW.astimezone(timezone.utc).isoformat(), "source": "health_connect"},
    ]}
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    n = store.import_readings("u1", [at(0, 120), at(1, 121), at(2, 121)])     # a 1-minute sensor
    assert n == 2
    rows = fake_db.writes[0][1]
    assert all(r["source"] == "health_connect" and r["user_id"] == "u1" for r in rows)


# ------------------------------------------------------- report

def test_glucose_summary():
    day = [at(60 * i, v) for i, v in enumerate((50, 65, 100, 150, 180, 200, 300))]
    g = rep.glucose_summary(day, TZ)
    assert g["count"] == 7 and g["very_low"] == 14.3 and g["low"] == 14.3 and g["in_range"] == 42.9 and g["high"] == 14.3 and g["very_high"] == 14.3
    assert g["gmi"] is None and g["sensor"] is False        # finger-pricks never give a GMI
    assert sum(p["count"] for p in g["by_part"]) == 7
    assert rep.glucose_summary([], TZ) == {"count": 0}


def test_gmi_needs_ten_sensor_days():
    cgm = lambda days: [at(-5 * i, 154) for i in range(288 * days)]
    assert rep.glucose_summary(cgm(5), TZ)["gmi"] is None
    assert rep.glucose_summary(cgm(14), TZ)["gmi"] == 7.0


def test_low_events_are_grouped():
    g = [at(0, 65), at(5, 58), at(10, 68), at(120, 60), at(125, 90)]
    e = rep.low_events(g, TZ)
    assert [x["value"] for x in e] == [60, 58]


def test_report_route(client, monkeypatch, fake_db):
    now = datetime.now(timezone.utc)
    fake_db.rows = {
        "profiles": [{"id": TEST_USER, "full_name": "Test", "timezone": "Asia/Karachi"}],
        "bg_readings": [{"user_id": TEST_USER, "value": 100 + i % 5, "logged_at": (now - timedelta(minutes=5 * i)).isoformat()} for i in range(2500)],
        "bolus_logs": [{"user_id": TEST_USER, "dose_units": 4, "logged_at": now.isoformat()}],
    }
    for name in ("services.care_store", "services.stress_pattern"):
        monkeypatch.setattr(__import__(name, fromlist=["x"]), "get_db", lambda: fake_db)
    r = client.get("/api/v1/report?days=14")
    assert r.status_code == 200
    body = r.json()
    assert body["glucose"]["count"] == 2500          # more than one page
    assert body["insulin"]["per_day"] == 4 and body["medicines"] == []
    assert client.get("/api/v1/report?days=900").status_code == 422


# ------------------------------------------------------- the user's own data

def test_export_has_every_table(monkeypatch, fake_db):
    fake_db.rows = {"meals": [{"user_id": "u1", "logged_at": "2026-11-24", "carbs": 5}, {"user_id": "u2", "logged_at": "2026-11-24", "carbs": 9}]}
    monkeypatch.setattr(store, "get_db", lambda: fake_db)
    r = store.export_all("u1")
    assert set(store.USER_TABLES) <= set(r) and len(r["meals"]) == 1


def test_delete_needs_the_word(client):
    for body in ({}, {"confirm": "yes"}, {"confirm": "delete"}):
        assert client.post("/api/v1/delete-account", json=body).status_code == 422


class _DeleteDB:
    def __init__(self, fail_on=None):
        self.log, self.fail_on = [], fail_on
        outer = self

        class Admin:
            def delete_user(self, uid):
                outer.log.append(("login", uid))
        self.auth = type("A", (), {"admin": Admin()})()

    def table(self, name):
        outer = self

        class Q:
            def delete(self): return self

            def eq(self, col, val):
                self.f = (col, val)
                return self

            def execute(self):
                if name == outer.fail_on:
                    raise RuntimeError("no connection")
                outer.log.append((name, *self.f))
        return Q()


def test_delete_removes_only_this_user_and_the_login_last(monkeypatch):
    db = _DeleteDB()
    monkeypatch.setattr(store, "get_db", lambda: db)
    store.delete_account("u1")
    assert db.log[-1] == ("login", "u1") and db.log[-2] == ("profiles", "id", "u1")
    assert all(x[-1] == "u1" for x in db.log) and {x[0] for x in db.log} >= set(store.USER_TABLES)
    names = [x[0] for x in db.log]
    assert names.index("medicine_logs") < names.index("medicines")


def test_login_stays_when_deleting_data_fails(monkeypatch):
    db = _DeleteDB(fail_on="meals")
    monkeypatch.setattr(store, "get_db", lambda: db)
    with pytest.raises(RuntimeError):
        store.delete_account("u1")
    assert not any(x[0] == "login" for x in db.log)


def test_every_table_with_user_rows_is_covered():
    """A new table must be added to USER_TABLES, or delete and export miss it."""
    import re
    from pathlib import Path
    root = Path(store.__file__).resolve().parents[1]
    used = set()
    for f in [*root.glob("services/*.py"), *root.glob("routers/*.py")]:
        used |= set(re.findall(r'table\(\s*"([a-z_]+)"', f.read_text(encoding="utf-8")))
        used |= set(re.findall(r'_rows\(\s*"([a-z_]+)"', f.read_text(encoding="utf-8")))
    assert used - {"profiles"} <= set(store.USER_TABLES)


@pytest.mark.parametrize("method,path", [
    ("get", "/api/v1/medicines"), ("post", "/api/v1/medicines"), ("get", "/api/v1/report"), ("get", "/api/v1/export"), ("post", "/api/v1/delete-account"),
])
def test_care_routes_need_login(anon_client, method, path):
    assert getattr(anon_client, method)(path).status_code in (401, 403)
