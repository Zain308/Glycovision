"""Shared helpers for the dev scripts in this folder."""

import sys

from core.config import BACKEND_ROOT, get_settings


def seed_user_id() -> str:
    """The Supabase user the scripts write test data for (SEED_USER_ID)."""
    user_id = get_settings().seed_user_id.strip()
    if not user_id:
        sys.exit(
            "SEED_USER_ID is not set. Add your Supabase user ID to "
            f"{BACKEND_ROOT / '.env'} (see .env.example)."
        )
    return user_id
