from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 64}
COOKIE_NAME = "omh_session"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_b64, dk_b64 = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), **_SCRYPT)
    return hmac.compare_digest(dk, base64.b64decode(dk_b64))


def create_token(user_id: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(minutes=s.access_token_minutes), "aud": "omh"}
    return jwt.encode(payload, s.omh_secret_key, algorithm="HS256")


def decode_token(token: str) -> str | None:
    try:
        data = jwt.decode(token, get_settings().omh_secret_key, algorithms=["HS256"], audience="omh")
    except jwt.PyJWTError:
        return None
    return data.get("sub")
