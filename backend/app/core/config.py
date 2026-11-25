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
    omh_field_key: str = ""  # key material for encrypting sensitive fields (MFA secrets); falls back to secret key
    access_token_minutes: int = 60 * 12
    cookie_secure: bool = True
    demo_login_enabled: bool = False  # only honoured when app_env == "development"
    api_docs_enabled: bool = True  # /api/docs and /api/openapi.json; must be false in production
    default_reporting_currency: str = "PLN"
    cors_origins: str = "http://localhost:3420,http://127.0.0.1:3420"
    nbp_api_base: str = "https://api.nbp.pl/api"
    budget_alert_threshold_pct: int = 80
    # Service-to-service auth (ecosystem-contracts/docs/authentication.md): per-service rotating HMAC keys
    # in a keyring file OUTSIDE the repo. Nothing secret lives in code or in this file.
    ecosystem_keyring_file: str = ""
    ecosystem_signing_key_id: str = ""  # OMH's own kid, used when OMH signs outgoing events
    ecosystem_max_clock_skew_seconds: int = 300
    omh_ragi_workspace_id: str = ""  # workspace that RAGI's org maps to (spec gap #23: owner decision)
    omh_ragi_organization_id: str = "arnovagroup"
    # Registration: closed by default. The owner account is created once, with a one-time setup token
    # (OMH_OWNER_SETUP_TOKEN, set in the environment, never committed) on a database with no real users.
    allow_registration: bool = False  # deprecated; use registration_mode
    registration_mode: str = "closed"  # closed | invite | open
    registration_open_confirmed: bool = False
    omh_owner_setup_token: str = ""
    public_base_url: str = "http://localhost:3420"
    github_client_id: str = ""
    github_client_secret: str = ""
    resend_api_key: str = ""
    mail_from: str = ""
    forwarded_allow_ips: str = "127.0.0.1,::1"
    email_verification_enabled: bool = False  # D4: no email provider; keep off
    mfa_pending_minutes: int = 10
    idle_timeout_minutes_privileged: int = 30
    idle_timeout_minutes: int = 120
    rates_auto_sync: bool = False  # refresh official FX rates every 6h while the API runs
    lockout_attempts: int = 5
    lockout_minutes: int = 15

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.app_env not in {"development", "test"}:
        problems = []
        if s.is_sqlite:
            problems.append("DATABASE_URL must point to PostgreSQL")
        if not s.omh_secret_key:
            problems.append("OMH_SECRET_KEY must be set")
        if not s.cookie_secure:
            problems.append("COOKIE_SECURE must be true")
        if s.demo_login_enabled:
            problems.append("DEMO_LOGIN_ENABLED must be false")
        if s.api_docs_enabled:
            problems.append("API_DOCS_ENABLED must be false")
        if s.registration_mode == "open" and not s.registration_open_confirmed:
            problems.append("REGISTRATION_MODE=open requires REGISTRATION_OPEN_CONFIRMED=true")
        if problems:
            raise RuntimeError("Refusing to start outside development: " + "; ".join(problems))
    if not s.omh_secret_key:
        import secrets
        s.omh_secret_key = secrets.token_urlsafe(48)
    if s.allow_registration and s.registration_mode == "closed":
        s.registration_mode = "open"  # transitional mapping
    return s
