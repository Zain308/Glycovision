"""
Entries made without internet: stored once, at the time they were made.
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import entries

USER = "00000000-0000-0000-0000-000000000001"      # as in conftest
ID = "3f0b8c1e-6a51-4b7e-9d5e-0a1b2c3d4e5f"


class DbError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@pytest.fixture
def db(monkeypatch, fake_db):
    from routers import health
    from services import fitness_store
    for module in (entries, health, fitness_store):
        monkeypatch.setattr(module, "get_db", lambda: fake_db)
    monkeypatch.setattr(health.fitness_store, "save_days", lambda *a: None)
    return fake_db


CASES = [
    ("/api/v1/log-bg", {"value": 120}, "bg_readings"),
    ("/api/v1/log-meal", {"food_name": "Roti", "carbs": 30}, "meals"),
    ("/api/v1/log-bolus", {"dose_units": 4}, "bolus_logs"),
    ("/api/v1/log-activity", {"activity": "Walk", "minutes": 20}, "activity_logs"),
]


@pytest.mark.parametrize("path,body,table", CASES)
def test_a_new_entry_uses_the_server_time(client, db, path, body, table):
    assert client.post(path, json={**body, "client_id": ID}).status_code == 200
    (name, row), = db.writes
    assert name == table and row["client_id"] == ID and row["user_id"] == USER
    assert "logged_at" not in row and "age_seconds" not in row


@pytest.mark.parametrize("path,body,table", CASES)
def test_a_late_entry_keeps_its_time(client, db, path, body, table):
    assert client.post(path, json={**body, "client_id": ID, "age_seconds": 7200}).status_code == 200
    at = datetime.fromisoformat(db.writes[0][1]["logged_at"])
    assert abs(datetime.now(timezone.utc) - timedelta(hours=2) - at) < timedelta(seconds=20)


@pytest.mark.parametrize("path,body,table", CASES)
def test_the_same_entry_is_never_stored_twice(client, db, path, body, table):
    db.rows[table] = [{"user_id": USER, "client_id": ID}]
    assert client.post(path, json={**body, "client_id": ID, "age_seconds": 60}).status_code == 200
    assert db.writes == []


def test_another_users_id_does_not_block(client, db):
    db.rows["bolus_logs"] = [{"user_id": "someone-else", "client_id": ID}]
    assert client.post("/api/v1/log-bolus", json={"dose_units": 4, "client_id": ID}).status_code == 200
    assert len(db.writes) == 1


def test_old_apps_still_work(client, db):
    assert client.post("/api/v1/log-bg", json={"value": 120}).status_code == 200
    assert db.writes[0][1] == {"user_id": USER, "value": 120}


@pytest.mark.parametrize("extra", [{"age_seconds": -5}, {"age_seconds": 31 * 24 * 3600}, {"client_id": "not-an-id"}])
def test_bad_extras_are_refused(client, db, extra):
    assert client.post("/api/v1/log-bolus", json={"dose_units": 4, **extra}).status_code == 422
    assert db.writes == []


def test_vitals_late_and_once(client, db):
    body = {"kind": "hba1c", "value": 7.1, "client_id": ID, "age_seconds": 3600}
    assert client.post("/api/v1/vitals", json=body).status_code == 200
    table, rows = db.writes[0]
    assert table == "vitals" and rows[0]["client_id"] == ID
    assert datetime.now(timezone.utc) - datetime.fromisoformat(rows[0]["logged_at"]) > timedelta(minutes=59)
    db.writes.clear()
    db.rows["vitals"] = [{"user_id": USER, "client_id": ID}]
    assert client.post("/api/v1/vitals", json=body).status_code == 200
    assert db.writes == []


class Broken:
    """A database whose select or insert fails."""

    def __init__(self, real, on_select=None, on_insert=None):
        self.real, self.on_select, self.on_insert = real, on_select, on_insert

    def table(self, name):
        q = self.real.table(name)
        run = q.execute

        def execute():
            error = self.on_insert if q.inserted is not None else self.on_select
            if error:
                raise error
            return run()
        q.execute = execute
        return q


NO_COLUMN = DbError("42703", "column bolus_logs.client_id does not exist")


def test_two_copies_at_the_same_moment(client, db, monkeypatch):
    broken = Broken(db, on_insert=DbError("23505", "duplicate key value violates unique constraint"))
    monkeypatch.setattr(entries, "get_db", lambda: broken)
    assert client.post("/api/v1/log-bolus", json={"dose_units": 4, "client_id": ID}).status_code == 200


def test_without_the_database_update_new_entries_work_and_repeats_wait(client, db, monkeypatch):
    monkeypatch.setattr(entries, "get_db", lambda: Broken(db, on_select=NO_COLUMN))
    assert client.post("/api/v1/log-bolus", json={"dose_units": 4, "client_id": ID}).status_code == 200
    assert "client_id" not in db.writes[0][1]
    db.writes.clear()
    # A repeat can't be told from a new dose: refuse, the phone keeps it.
    assert client.post("/api/v1/log-bolus", json={"dose_units": 4, "client_id": ID, "age_seconds": 60}).status_code == 503
    assert client.post("/api/v1/log-activity", json={"activity": "Walk", "minutes": 5, "client_id": ID, "age_seconds": 60}).status_code == 503
    assert db.writes == []


def test_other_database_errors_are_not_swallowed(client, db, monkeypatch):
    monkeypatch.setattr(entries, "get_db", lambda: Broken(db, on_select=DbError("500", "connection lost")))
    with pytest.raises(DbError):
        client.post("/api/v1/log-bolus", json={"dose_units": 4, "client_id": ID})
    assert db.writes == []


# ------------------------------------------------- deleting a wrong entry

@pytest.fixture
def dash(monkeypatch, fake_db):
    from routers import dashboard
    monkeypatch.setattr(dashboard, "get_db", lambda: fake_db)
    monkeypatch.setattr(dashboard, "get_profile_row", lambda db, uid: {})
    return fake_db


@pytest.mark.parametrize("kind,table", [("bg", "bg_readings"), ("meal", "meals"), ("insulin", "bolus_logs")])
def test_own_entry_can_be_deleted(client, dash, kind, table):
    dash.rows[table] = [{"id": 5, "user_id": USER}]
    assert client.delete(f"/api/v1/entries/{kind}/5").status_code == 200
    assert dash.writes == [(table, "deleted")]


@pytest.mark.parametrize("path", ["/api/v1/entries/bg/5", "/api/v1/entries/medicine/5", "/api/v1/entries/bg/6"])
def test_others_or_unknown_entries_are_untouched(client, dash, path):
    dash.rows["bg_readings"] = [{"id": 5, "user_id": "someone-else"}, {"id": 6, "user_id": "someone-else"}]
    assert client.delete(path).status_code == 404
    assert dash.writes == []


def test_entry_delete_needs_login(anon_client):
    assert anon_client.delete("/api/v1/entries/bg/5").status_code in (401, 403)


def test_timeline_gives_ids(client, dash):
    now = datetime.now(timezone.utc).isoformat()
    dash.rows = {"bg_readings": [{"id": 1, "user_id": USER, "value": 140, "logged_at": now}],
                 "meals": [{"id": 2, "user_id": USER, "food_name": "Roti", "carbs": 30, "calories": 120, "logged_at": now}],
                 "bolus_logs": [{"id": 3, "user_id": USER, "dose_units": 4, "carbs": 30, "logged_at": now}]}
    events = client.get("/api/v1/timeline-today").json()["events"]
    assert sorted((e["type"], e["id"]) for e in events) == [("bg", 1), ("insulin", 3), ("meal", 2)]
