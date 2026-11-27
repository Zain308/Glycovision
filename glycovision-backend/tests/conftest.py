"""
Shared test setup for the GlycoVision backend.

* Puts the backend folder on sys.path so `services`, `routers`, ... import.
* FakeDB: a tiny stand-in for the Supabase client's query builder
  (table().select().eq().gte().order().limit().execute()), so tests never
  touch the real database.
* `client`: a FastAPI TestClient with login replaced by a fixed test user.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_USER = "00000000-0000-0000-0000-000000000001"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self._order = None
        self._limit = None
        self._range = None
        self.inserted = None

    # Builder methods return self, like the real client.
    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) >= str(val))
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) < str(val))
        return self

    def delete(self):
        self.inserted = "deleted"
        return self

    def range(self, a, b):
        self._range = (a, b)
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, row):
        self.inserted = row
        return self

    def upsert(self, rows, on_conflict=None):
        self.inserted = rows
        return self

    def update(self, row):
        self.inserted = row
        return self

    def execute(self):
        if self.inserted is not None:
            self.db.writes.append((self.table, self.inserted))
            return _Result([self.inserted])
        rows = [r for r in self.db.rows.get(self.table, []) if all(f(r) for f in self.filters)]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: str(r.get(col)), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._range is not None:
            rows = rows[self._range[0]: self._range[1] + 1]
        return _Result(rows)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.writes = []

    def table(self, name):
        return _Query(self, name)


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Each test starts with empty rate-limit counters."""
    from core import rate_limit
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest.fixture
def fake_db():
    return FakeDB()


@pytest.fixture
def client(monkeypatch):
    """API client logged in as TEST_USER (real JWT check bypassed)."""
    from fastapi.testclient import TestClient

    import main
    from core.auth import get_current_user

    main.app.dependency_overrides[get_current_user] = lambda: TEST_USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    """API client with no login, to check routes are protected."""
    from fastapi.testclient import TestClient

    import main

    main.app.dependency_overrides.clear()
    return TestClient(main.app)
