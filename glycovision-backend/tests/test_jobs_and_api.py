"""
Scan job store (services/job_manager.py) and API routes through FastAPI's
TestClient: login required, validation, and per-user isolation.
"""

import time

import pytest

from services import job_manager
TEST_USER = "00000000-0000-0000-0000-000000000001"  # same as conftest.TEST_USER


# ---------------------------------------------------------------- jobs

def test_job_lifecycle_and_isolation():
    jid = job_manager.create_job("alice")
    assert job_manager.get_job_for_user(jid, "alice")["status"] == "pending"
    assert job_manager.get_job_for_user(jid, "bob") is None  # another user can't read it
    job_manager.set_job_result(jid, {"ok": True})
    assert job_manager.get_job_for_user(jid, "alice")["result"] == {"ok": True}


def test_jobs_expire(monkeypatch):
    jid = job_manager.create_job("alice")
    real = job_manager.time.monotonic
    monkeypatch.setattr(job_manager.time, "monotonic", lambda: real() + job_manager.JOB_TTL_SECONDS + 1)
    job_manager.create_job("bob")  # creating a job prunes expired ones
    assert job_manager.get_job_for_user(jid, "alice") is None


def test_internal_fields_not_exposed():
    jid = job_manager.create_job("alice")
    assert "_created" not in job_manager.get_job_for_user(jid, "alice")


def test_unknown_job_is_none():
    assert job_manager.get_job_for_user("nope", "alice") is None


def test_job_copy_cannot_mutate_store():
    jid = job_manager.create_job("alice")
    job_manager.get_job_for_user(jid, "alice")["status"] = "hacked"
    assert job_manager.get_job_for_user(jid, "alice")["status"] == "pending"


def test_old_jobs_are_cleaned_up():
    """Fixed after QA: the store is capped (oldest dropped first)."""
    before = len(job_manager._jobs)
    for _ in range(500):
        job_manager.set_job_result(job_manager.create_job("load"), {"big": "x" * 1000})
    assert len(job_manager._jobs) - before < 500, "job store grows without limit"


# ---------------------------------------------------------------- auth

@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/dashboard-summary"), ("get", "/api/v1/timeline-today"), ("get", "/api/v1/foods"),
        ("get", "/api/v1/current-iob"), ("get", "/api/v1/profile"), ("get", "/api/v1/dish-nutrition/biryani"),
        ("post", "/api/v1/calculate-intervention"), ("post", "/api/v1/log-bg"), ("post", "/api/v1/log-meal"),
    ],
)
def test_routes_require_login(anon_client, method, path):
    r = anon_client.request(method.upper(), path, json={} if method == "post" else None)
    assert r.status_code == 401, r.text


def test_garbage_token_rejected(anon_client):
    r = anon_client.get("/api/v1/foods", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


# ---------------------------------------------------------------- routes

def test_dose_endpoint_validates(client):
    r = client.post("/api/v1/calculate-intervention", json={"current_bg": 5, "isf": 50, "icr": 10, "total_carbs": 60})
    assert r.status_code == 422


def test_dose_endpoint_computes(client, monkeypatch):
    import routers.bolus as bolus_router
    monkeypatch.setattr(bolus_router, "get_stress_context", lambda uid: {"status": "none"})
    r = client.post("/api/v1/calculate-intervention", json={"current_bg": 150, "target_bg": 110, "isf": 50, "icr": 10, "total_carbs": 60, "iob": 0})
    assert r.status_code == 200 and r.json()["recommended_total_dose_units"] == 6.8


def test_dose_survives_stress_context_failure(client, monkeypatch):
    import routers.bolus as bolus_router

    def boom(uid):
        raise RuntimeError("voice db down")

    monkeypatch.setattr(bolus_router, "get_stress_context", boom)
    r = client.post("/api/v1/calculate-intervention", json={"current_bg": 150, "isf": 50, "icr": 10, "total_carbs": 60})
    assert r.status_code == 200


def test_dish_nutrition_known_and_unknown(client):
    assert client.get("/api/v1/dish-nutrition/chapati?confidence=0.4").status_code == 200
    assert client.get("/api/v1/dish-nutrition/not_food").status_code == 404
    assert client.get("/api/v1/dish-nutrition/../../etc").status_code == 404


def test_dish_nutrition_rejects_bad_confidence(client):
    """Fixed after QA: confidence outside 0-1 is a 422, not a 500 crash."""
    r = client.get("/api/v1/dish-nutrition/chapati?confidence=7.5")
    assert r.status_code == 422


def test_food_library_shape(client):
    r = client.get("/api/v1/foods")
    foods = r.json()["foods"]
    assert r.status_code == 200 and len(foods) >= 80
    f = next(x for x in foods if x["food_name"] == "chapati")
    assert f["portion"]["unit"] == "roti" and 15 <= f["per_portion"]["carbs"] <= 30


def test_timeline_merges_and_isolates(client, monkeypatch, fake_db):
    import routers.dashboard as dash
    now = "2099-01-01T10:00:00+00:00"
    fake_db.rows = {
        "profiles": [{"id": TEST_USER}],
        "meals": [{"user_id": TEST_USER, "food_name": "Chai", "carbs": 5, "calories": 30, "logged_at": now}],
        "bolus_logs": [{"user_id": TEST_USER, "dose_units": 4, "carbs": 60, "logged_at": "2099-01-01T09:00:00+00:00"}],
        "bg_readings": [
            {"user_id": TEST_USER, "value": 65, "logged_at": "2099-01-01T11:00:00+00:00"},
            {"user_id": "someone-else", "value": 300, "logged_at": now},
        ],
    }
    monkeypatch.setattr(dash, "get_db", lambda: fake_db)
    events = client.get("/api/v1/timeline-today").json()["events"]
    assert [e["type"] for e in events] == ["bg", "meal", "insulin"]  # newest first
    assert all(e.get("value") != 300 for e in events)  # other user's data excluded


def test_log_bg_validates_range(client, monkeypatch, fake_db):
    import routers.bg as bg_router
    monkeypatch.setattr(bg_router, "get_db", lambda: fake_db, raising=False)
    assert client.post("/api/v1/log-bg", json={"value": 900}).status_code == 422
    assert client.post("/api/v1/log-bg", json={"value": "abc"}).status_code == 422


def test_log_meal_rejects_absurd_carbs(client, monkeypatch, fake_db):
    """Fixed after QA: meals above 500 g carbs are rejected before any write."""
    import routers.meal as meal_router
    monkeypatch.setattr(meal_router, "get_db", lambda: fake_db)  # never touch the real database
    r = client.post("/api/v1/log-meal", json={"food_name": "x", "carbs": 50000})
    assert r.status_code == 422, f"accepted and written: {fake_db.writes}"


def test_unknown_signing_key_is_401_not_500(anon_client, monkeypatch):
    """Found on the live server: a token with an unknown key id crashed with 500."""
    import jwt as pyjwt
    from core import auth

    class FakeJwks:
        def get_signing_key_from_jwt(self, token):
            raise pyjwt.PyJWKClientError('Unable to find a signing key that matches: "test"')

    monkeypatch.setattr(auth, "_jwk_client", FakeJwks())
    r = anon_client.get("/api/v1/foods", headers={"Authorization": "Bearer a.b.c"})
    assert r.status_code == 401


def test_key_service_down_is_503(anon_client, monkeypatch):
    import jwt as pyjwt
    from core import auth

    class DownJwks:
        def get_signing_key_from_jwt(self, token):
            raise pyjwt.PyJWKClientConnectionError("timeout")

    monkeypatch.setattr(auth, "_jwk_client", DownJwks())
    r = anon_client.get("/api/v1/foods", headers={"Authorization": "Bearer a.b.c"})
    assert r.status_code == 503
