"""Lookups and owner-only password reset for Our Money Hub."""
from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.client_ip import client_ip
from app.core.mailer import send_email
from app.core.passwords import hibp_pwned_count, validate_password
from app.core.ratelimit import hit
from app.core.recovery_codes import consume_code
from app.core.security import hash_password, revoke as revoke_session
from app.database.models import InstanceSetting, PasswordResetCode, User, UserSession, WorkspaceMember
from app.modules.audit.service import audit

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)
def _aware(dt):
    if dt is None:
        return None
    return dt if getattr(dt, "tzinfo", None) else dt.replace(tzinfo=UTC)


GENERIC = {"status": "accepted", "message": "If an account exists for those details, we sent a reset code."}
RESET_MINUTES = 15


class ResetError(Exception):
    def __init__(self, message: str, status: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def lookup_user(db: Session, identifier: str) -> tuple[str, User | None]:
    raw = (identifier or "").strip()
    if not raw:
        return "", None
    if "@" in raw:
        key = raw.lower()
        return key, db.scalar(select(User).where(func.lower(User.email) == key))
    key = raw.lower()
    return key, db.scalar(select(User).where(func.lower(User.username) == key))


INSTANCE_OWNER_KEY = "instance_owner_user_id"


def instance_owner(db: Session) -> User | None:
    row = db.get(InstanceSetting, INSTANCE_OWNER_KEY)
    if row and row.value:
        return db.get(User, row.value)
    return None


def is_owner(db: Session, user: User | None) -> bool:
    if not user or user.is_demo:
        return False
    owner = instance_owner(db)
    return owner is not None and owner.id == user.id


def ensure_instance_owner(db: Session, user: User) -> None:
    """Record the first real user as the instance owner. Later accounts cannot take this over."""
    if user.is_demo or db.get(InstanceSetting, INSTANCE_OWNER_KEY):
        return
    db.add(InstanceSetting(key=INSTANCE_OWNER_KEY, value=user.id))


def _rate(db: Session, request: Request, key: str) -> None:
    ip = client_ip(request)
    allowed, retry = hit(db, f"reset:ip:{ip}", 5, 3600)
    if not allowed:
        raise ResetError("Too many attempts. Try again later.", 429, retry)
    allowed, retry = hit(db, f"reset:id:{key}", 3, 3600)
    if not allowed:
        raise ResetError("Too many attempts. Try again later.", 429, retry)


def request_code(db: Session, identifier: str, request: Request) -> dict:
    key, user = lookup_user(db, identifier)
    _rate(db, request, key or "empty")
    if is_owner(db, user):
        now = datetime.now(UTC)
        unused = db.scalars(select(PasswordResetCode).where(
            PasswordResetCode.user_id == user.id, PasswordResetCode.used_at.is_(None))).all()
        for row in unused:
            row.used_at = now
        code = f"{secrets.randbelow(1_000_000):06d}"
        db.add(PasswordResetCode(
            user_id=user.id, code_hash=_hasher.hash(code),
            expires_at=now + timedelta(minutes=RESET_MINUTES),
            created_ip=client_ip(request),
        ))
        send_email(
            to=user.email,
            subject="Your Our Money Hub password reset code",
            text=(
                f"Your Our Money Hub password reset code is {code}.\n\n"
                f"It expires in {RESET_MINUTES} minutes and can be used once.\n"
                "If you did not ask for this, you can ignore this email.\n"
            ),
            html=(
                f"<p>Your Our Money Hub password reset code is <strong>{code}</strong>.</p>"
                f"<p>It expires in {RESET_MINUTES} minutes and can be used once.</p>"
                "<p>If you did not ask for this, you can ignore this email.</p>"
            ),
        )
        audit(db, workspace_id=None, user_id=user.id, action="auth.password.reset_requested", entity="user", entity_id=user.id)
        db.commit()
    else:
        db.commit()
    return GENERIC


def _set_new_password(db: Session, user: User, password: str, *, method: str) -> None:
    validate_password(password, email=user.email, name=user.display_name or user.username or "")
    _, breach = hibp_pwned_count(password)
    user.password_hash = hash_password(password)
    user.failed_logins, user.locked_until = 0, None
    now = datetime.now(UTC)
    for sess in db.scalars(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))).all():
        sess.revoked_at = now
    from app.modules.trusted_devices import revoke_all_for_user
    revoke_all_for_user(db, user.id)
    audit(db, workspace_id=None, user_id=user.id, action="auth.password.changed", entity="user",
          entity_id=user.id, detail={"method": method, "breach_check": breach})
    db.commit()


def confirm_code(db: Session, identifier: str, code: str, password: str, request: Request) -> None:
    key, user = lookup_user(db, identifier)
    _rate(db, request, key or "empty")
    raw = (code or "").strip()
    if len(raw) != 6 or not raw.isdigit() or not is_owner(db, user):
        raise ResetError("That code didn't match or has expired")
    now = datetime.now(UTC)
    rows = db.scalars(select(PasswordResetCode).where(
        PasswordResetCode.user_id == user.id, PasswordResetCode.used_at.is_(None))).all()
    matched = None
    dummy = _hasher.hash("000000")
    for row in rows or [type("X", (), {"code_hash": dummy, "id": None, "expires_at": now})()]:
        try:
            ok = _hasher.verify(row.code_hash, raw)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            ok = False
        if ok and getattr(row, "id", None) and matched is None and _aware(getattr(row, "expires_at", now)) > now:
            matched = row
    if matched is None:
        db.commit()
        raise ResetError("That code didn't match or has expired")
    matched.used_at = now
    try:
        _set_new_password(db, user, password, method="email_code")
    except ValueError as exc:
        raise ResetError(str(exc), 422) from exc


def confirm_recovery(db: Session, identifier: str, recovery_code: str, password: str, request: Request) -> None:
    key, user = lookup_user(db, identifier)
    _rate(db, request, key or "empty")
    if not is_owner(db, user) or not consume_code(db, user.id, recovery_code):
        db.commit()
        raise ResetError("That recovery code didn't match")
    try:
        _set_new_password(db, user, password, method="recovery_code")
    except ValueError as exc:
        raise ResetError(str(exc), 422) from exc


def set_password(db: Session, user: User, password: str) -> None:
    try:
        _set_new_password(db, user, password, method="authenticated")
    except ValueError as exc:
        raise ResetError(str(exc), 422) from exc
