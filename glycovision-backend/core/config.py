from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Always read glycovision-backend/.env, whatever folder the server or a
# script is started from.
BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """
    All configuration comes from environment variables or .env.
    See .env.example for every setting and what it does.
    """

    # --- Supabase -------------------------------------------------------
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # --- Nutrition lookup -------------------------------------------------
    calorieninjas_api_key: str = ""
    # Older name for the CalorieNinjas key; used if the one above is empty.
    food_ai_api_key: str = ""

    # --- Food recognition fallback (local Ollama) --------------------------
    # Used only when the ConvNeXt classifier is unsure. Turn off on servers
    # that don't run Ollama.
    use_ollama_fallback: bool = True
    ollama_url: str = "http://localhost:11434/api/generate"
    ollama_model: str = "moondream"

    # --- Audio (voice check) ----------------------------------------------
    # Full paths to ffmpeg/ffprobe. Leave empty to use the ones on PATH
    # (the normal case on Linux servers and Docker).
    ffmpeg_path: str = ""
    ffprobe_path: str = ""

    # --- HTTP ---------------------------------------------------------------
    # Comma-separated origins allowed by CORS, or * for any. The mobile app
    # is not affected by CORS; this matters only for browsers.
    cors_origins: str = "*"

    # --- Time ---------------------------------------------------------------
    # IANA zone used when a profile has no timezone set.
    default_timezone: str = "Asia/Karachi"

    # --- Dev scripts only (scripts/) -------------------------------------
    # Supabase user ID that the seed/check scripts write test data for.
    seed_user_id: str = ""

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]
        return origins or ["*"]


@lru_cache()
def get_settings():
    return Settings()
