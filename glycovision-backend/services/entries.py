"""
Entries that may have been made without internet.

The phone gives every entry a `client_id` and keeps it until the server has
answered. A lost answer means the same entry arrives again, so an id that is
already stored is never stored twice (a doubled insulin dose or meal would
change the plan).

`age_seconds` says how long ago the entry was made. It is measured on the
phone's own clock, so a phone with the wrong time still gives the right moment.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core.db import get_db

NOT_READY = "Saved entries can't be uploaded yet. The server needs its database update."


def made_at(payload, now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now - timedelta(seconds=payload.age_seconds or 0)


def _code(error: Exception) -> str:
    return str(getattr(error, "code", "") or "")


def _no_column(error: Exception) -> bool:
    """sql/2026-11-25_offline.sql has not been run."""
    text = str(error)
    return "client_id" in text and (
        _code(error) in ("PGRST204", "42703") or "does not exist" in text or "schema cache" in text
    )


def already_saved(table: str, user_id: str, payload) -> bool:
    if payload.client_id is None:
        return False
    try:
        rows = get_db().table(table).select("client_id").eq("user_id", user_id) \
            .eq("client_id", str(payload.client_id)).limit(1).execute().data
        return bool(rows)
    except Exception as error:
        if not _no_column(error):
            raise
        if payload.age_seconds is not None:
            # A second try can't be told from a new entry: keep it on the phone.
            raise HTTPException(status_code=503, detail=NOT_READY)
        payload.client_id = None
        return False


def save_once(table: str, user_id: str, row: dict, payload) -> bool:
    """True when stored now, False when it was stored before."""
    if already_saved(table, user_id, payload):
        return False
    row = {"user_id": user_id, **row}
    if payload.age_seconds is not None:
        row["logged_at"] = made_at(payload).isoformat()
    if payload.client_id is not None:
        row["client_id"] = str(payload.client_id)
    try:
        get_db().table(table).insert(row).execute()
    except Exception as error:
        # Two copies arrived at the same moment; the database kept one.
        if payload.client_id is not None and _code(error) == "23505":
            return False
        raise
    return True
