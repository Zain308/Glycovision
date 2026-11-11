"""
Helpers for per-user profile lookup and local time.

The HUPA-UCM training data uses local clock time, and patients think of
"today" in their own time zone, so day boundaries and time-of-day model
features must use the user's zone rather than UTC.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from core.config import get_settings

settings = get_settings()


def get_profile_row(db, user_id: str) -> dict | None:
    """
    Return the user's profile row, or None if it does not exist.

    Uses limit(1) instead of .single(), which raises an error
    (surfacing as HTTP 500) when no row exists.
    """
    res = (
        db.table("profiles")
        .select("*")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def user_timezone(profile: dict | None) -> ZoneInfo:
    """
    The user's time zone from profiles.timezone if that column exists
    and holds a valid IANA name, otherwise the server default.
    """
    candidates = []
    if profile:
        candidates.append(profile.get("timezone"))
    candidates.append(settings.default_timezone)

    for name in candidates:
        if not name:
            continue
        try:
            return ZoneInfo(str(name))
        except (ZoneInfoNotFoundError, ValueError):
            continue

    return ZoneInfo("UTC")


def local_day_start_utc_iso(tz: ZoneInfo) -> str:
    """Midnight today in the user's zone, as a UTC ISO timestamp."""
    local_now = datetime.now(tz)
    local_midnight = local_now.replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return local_midnight.astimezone(timezone.utc).isoformat()
