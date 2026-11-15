"""Rate limiting (core/rate_limit.py): 429 after the per-minute limit."""

from core import rate_limit


def test_heavy_routes_limited_to_20_per_minute(anon_client):
    codes = [anon_client.post("/api/v1/analyze-meal-async").status_code for _ in range(21)]
    assert codes[:20].count(429) == 0      # first 20 reach the app (401: no login)
    assert codes[20] == 429                  # 21st is refused


def test_429_has_retry_after_and_plain_message(anon_client):
    for _ in range(rate_limit.LIMITS["heavy"]):
        anon_client.post("/api/v1/analyze-meal-async")
    r = anon_client.post("/api/v1/analyze-meal-async")
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    assert "Too many requests" in r.json()["detail"]


def test_limits_are_per_caller(anon_client):
    for _ in range(rate_limit.LIMITS["heavy"]):
        anon_client.post("/api/v1/analyze-meal-async", headers={"Authorization": "Bearer user-a"})
    assert anon_client.post("/api/v1/analyze-meal-async", headers={"Authorization": "Bearer user-a"}).status_code == 429
    # a different user is not blocked by user A
    assert anon_client.post("/api/v1/analyze-meal-async", headers={"Authorization": "Bearer user-b"}).status_code != 429


def test_normal_routes_have_higher_limit(anon_client):
    codes = [anon_client.get("/api/v1/foods").status_code for _ in range(rate_limit.LIMITS["heavy"] + 5)]
    assert 429 not in codes


def test_health_is_never_limited(anon_client):
    assert all(anon_client.get("/health").status_code == 200 for _ in range(200))


def test_cheap_reads_use_the_normal_limit(anon_client):
    """/stress-context is loaded by Home on every visit: it must not hit the 20/min limit."""
    codes = [anon_client.get("/api/v1/stress-context").status_code for _ in range(rate_limit.LIMITS["heavy"] + 5)]
    assert 429 not in codes
