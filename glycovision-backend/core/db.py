from supabase import create_client, Client

from core.config import get_settings


settings = get_settings()


def get_db() -> Client:
    """
    Create a Supabase client for the current backend operation.

    We intentionally avoid sharing one global synchronous client
    across concurrent FastAPI worker threads.
    """

    if not settings.supabase_url:
        raise RuntimeError(
            "SUPABASE_URL is not configured."
        )

    if not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is not configured."
        )

    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )