"""GitHub OAuth with state + PKCE. Each app has its own OAuth app; no cross-app SSO."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
EMAILS_URL = "https://api.github.com/user/emails"
COOKIE_MAX_AGE = 600
# Only the allowlisted GitHub account may sign in. Anyone else is rejected with no account created.
ALLOWED_GITHUB_USER_ID = "137049568"
ALLOWED_GITHUB_LOGIN = "arnold-rg"


def is_allowed_github_account(profile: dict) -> bool:
    user_id = str(profile.get("id") or "")
    login = (profile.get("login") or "").strip().lower()
    return user_id == ALLOWED_GITHUB_USER_ID and login == ALLOWED_GITHUB_LOGIN



def redirect_uri() -> str:
    base = (get_settings().public_base_url or "").rstrip("/")
    return f"{base}/auth/github/callback"


def _sign(payload: str) -> str:
    secret = (get_settings().omh_secret_key or get_settings().omh_owner_setup_token or "dev").encode()
    sig = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify(blob: str, max_age: int = COOKIE_MAX_AGE) -> dict[str, str] | None:
    if not blob or "." not in blob:
        return None
    payload, _, sig = blob.rpartition(".")
    secret = (get_settings().omh_secret_key or get_settings().omh_owner_setup_token or "dev").encode()
    expected = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or time.time() - float(data.get("ts") or 0) > max_age:
        return None
    return {k: str(v) for k, v in data.items() if k != "ts"}


def new_pkce_state() -> tuple[str, str, str]:
    """Return (state, cookie_value, authorization_url)."""
    s = get_settings()
    if not s.github_client_id:
        raise RuntimeError("GitHub sign-in is not configured")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"state": state, "verifier": verifier, "ts": time.time()}).encode()).decode()
    cookie = _sign(payload)
    params = {
        "client_id": s.github_client_id,
        "redirect_uri": redirect_uri(),
        "scope": "read:user user:email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return state, cookie, f"{AUTHORIZE_URL}?{urlencode(params)}"


def parse_cookie(blob: str, state: str) -> str | None:
    data = _verify(blob)
    if not data or not hmac.compare_digest(data.get("state") or "", state or ""):
        return None
    return data.get("verifier")


def exchange(code: str, verifier: str) -> dict[str, Any]:
    s = get_settings()
    resp = httpx.post(
        TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": s.github_client_id,
            "client_secret": s.github_client_secret,
            "code": code,
            "redirect_uri": redirect_uri(),
            "code_verifier": verifier,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError("GitHub did not return an access token")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "Arnova-OMH"}
    user = httpx.get(USER_URL, headers=headers, timeout=10.0)
    user.raise_for_status()
    emails = httpx.get(EMAILS_URL, headers=headers, timeout=10.0)
    emails.raise_for_status()
    profile = user.json()
    primary = None
    for row in emails.json() or []:
        if row.get("primary") and row.get("verified") and row.get("email"):
            primary = row
            break
    return {"profile": profile, "primary_email": primary}
