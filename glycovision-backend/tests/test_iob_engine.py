"""Insulin-on-board model (services/iob_engine.py)."""

from datetime import datetime, timedelta, timezone

import pytest

from services import iob_engine
from services.iob_engine import (
    DEFAULT_DIA_HOURS,
    effective_dia_hours,
    iob_fraction_remaining,
)


@pytest.mark.parametrize("dia_h", [3, 4, 5, 6, 8])
def test_curve_starts_full_and_ends_empty(dia_h):
    dia = dia_h * 60
    assert iob_fraction_remaining(0, dia) == 1.0
    assert iob_fraction_remaining(-10, dia) == 1.0
    assert iob_fraction_remaining(dia, dia) == 0.0
    assert iob_fraction_remaining(dia + 30, dia) == 0.0


@pytest.mark.parametrize("dia_h", [3, 4, 6, 8])
def test_curve_is_monotonic_and_bounded(dia_h):
    dia = dia_h * 60
    prev = 1.0
    for t in range(0, dia + 1, 5):
        f = iob_fraction_remaining(t, dia)
        assert 0.0 <= f <= 1.0
        assert f <= prev + 1e-9, f"IOB went up at t={t}"
        prev = f


def test_about_half_left_mid_way():
    # Exponential model with 75-min peak, 4 h DIA: roughly half left at ~2 h.
    f = iob_fraction_remaining(120, 240)
    assert 0.3 < f < 0.7


@pytest.mark.parametrize(
    "raw,expected",
    [(4, 4.0), (2, 3.0), (2.5, 3.0), (9, 8.0), (0, DEFAULT_DIA_HOURS), (-1, DEFAULT_DIA_HOURS),
     (None, DEFAULT_DIA_HOURS), ("abc", DEFAULT_DIA_HOURS), (float("nan"), DEFAULT_DIA_HOURS), ("5", 5.0)],
)
def test_effective_dia_clamps(raw, expected):
    assert effective_dia_hours(raw) == expected


def test_calculate_current_iob_sums_recent_doses(monkeypatch, fake_db):
    now = datetime.now(timezone.utc)
    fake_db.rows["bolus_logs"] = [
        {"user_id": "u1", "dose_units": 4, "logged_at": (now - timedelta(minutes=1)).isoformat()},
        {"user_id": "u1", "dose_units": 2, "logged_at": (now - timedelta(hours=10)).isoformat()},  # too old
        {"user_id": "other", "dose_units": 9, "logged_at": now.isoformat()},  # another user
    ]
    monkeypatch.setattr(iob_engine, "get_db", lambda: fake_db)
    iob = iob_engine.calculate_current_iob("u1", 4)
    assert 3.9 <= iob <= 4.0  # only the fresh 4 u dose, nearly all active


def test_calculate_current_iob_handles_z_timestamps(monkeypatch, fake_db):
    now = datetime.now(timezone.utc)
    fake_db.rows["bolus_logs"] = [
        {"user_id": "u1", "dose_units": 3, "logged_at": (now - timedelta(minutes=60)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    ]
    monkeypatch.setattr(iob_engine, "get_db", lambda: fake_db)
    assert 0 < iob_engine.calculate_current_iob("u1", 4) < 3
