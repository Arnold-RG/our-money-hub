from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    app_name: str = "Our Money Hub"
    app_env: str = "development"
    # Postgres in normal use; sqlite fallback when DATABASE_URL is not set.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'omh-dev.sqlite3'}"
    # Must be provided via environment outside development. Dev default is random per process.
    omh_secret_key: str = ""
    access_token_minutes: int = 60 * 12
    cookie_secure: bool = False
    demo_login_enabled: bool = True
    default_reporting_currency: str = "PLN"
    cors_origins: str = "http://localhost:3100,http://127.0.0.1:3100"
    nbp_api_base: str = "https://api.nbp.pl/api"
    budget_alert_threshold_pct: int = 80

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.omh_secret_key:
        if s.app_env not in {"development", "test"}:
            raise RuntimeError("OMH_SECRET_KEY must be set outside development")
        import secrets

        s.omh_secret_key = secrets.token_urlsafe(48)
    return s
