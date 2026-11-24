"""Passwords (Argon2id), opaque revocable sessions, TOTP MFA with encrypted secrets."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.core.config import get_settings

COOKIE_NAME = "omh_session"
_ph = PasswordHasher()  # Argon2id, library defaults (RFC 9106 low-memory profile)
_DUMMY = _ph.hash("timing-equaliser-not-a-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, stored: str | None) -> bool:
    try:
        return _ph.verify(stored or _DUMMY, password) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(db: Session, user_id: str, *, mfa_pending: bool = False) -> str:
    from app.database.models import UserSession

    token = secrets.token_urlsafe(32)
    minutes = 10 if mfa_pending else get_settings().access_token_minutes
    db.add(UserSession(token_hash=token_hash(token), user_id=user_id, mfa_pending=mfa_pending,
                       expires_at=datetime.now(UTC) + timedelta(minutes=minutes)))
    db.flush()
    return token


def load_session(db: Session, token: str | None, *, allow_mfa_pending: bool = False):
    from app.database.models import UserSession

    if not token:
        return None
    s = db.get(UserSession, token_hash(token))
    if not s or s.revoked_at:
        return None
    exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=UTC)
    if exp < datetime.now(UTC):
        return None
    if s.mfa_pending and not allow_mfa_pending:
        return None
    return s


def revoke(db: Session, token: str | None) -> None:
    s = load_session(db, token, allow_mfa_pending=True)
    if s:
        s.revoked_at = datetime.now(UTC)


def _fernet() -> Fernet:
    s = get_settings()
    key_material = (s.omh_field_key or s.omh_secret_key).encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(b"omh-field-encryption:" + key_material).digest())
    return Fernet(key)


def encrypt_field(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


def new_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str, last_counter: int | None) -> int | None:
    """Return the matched time-step counter, or None. Rejects re-use of an already used step (replay)."""
    code = (code or "").strip().replace(" ", "")
    if not (code.isascii() and code.isdigit() and len(code) == 6):
        return None
    totp = pyotp.TOTP(secret)
    now = datetime.now(UTC)
    for offset in (-1, 0, 1):
        t = now + timedelta(seconds=30 * offset)
        if hmac.compare_digest(totp.at(t), code):
            counter = totp.timecode(t)
            if last_counter is not None and counter <= last_counter:
                return None
            return counter
    return None
