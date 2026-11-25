"""Owner trusted-device cookies: hashed DB rows, TOTP-only unlock, revocable in Settings."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.client_ip import client_ip
from app.core.config import get_settings
from app.core.security import decrypt_field, token_hash, verify_totp
from app.database.models import TrustedDevice, User
from app.modules.audit.service import audit

import secrets

TRUSTED_COOKIE = "__Host-omh_trusted"
HOST_ATTRS = dict(httponly=True, secure=True, samesite="lax", path="/")
MAX_DEVICES = 15
MFA_MAX_FAILURES = 5


def device_label(user_agent: str | None) -> str:
    ua = (user_agent or "").strip()
    if not ua:
        return "This device"
    low = ua.lower()
    os_name = (
        "iPhone" if "iphone" in low else
        "iPad" if "ipad" in low else
        "Android" if "android" in low else
        "macOS" if "mac os" in low or "macintosh" in low else
        "Windows" if "windows" in low else
        "Linux" if "linux" in low else
        "this device"
    )
    browser = (
        "Edge" if "edg/" in low else
        "Chrome" if "chrome" in low and "chromium" not in low else
        "Firefox" if "firefox" in low else
        "Safari" if "safari" in low else
        "Browser"
    )
    if os_name == "this device":
        return browser
    return f"{browser} on {os_name}"


def _days() -> int:
    return max(1, int(getattr(get_settings(), "trusted_device_days", 90)))


def _max_age() -> int:
    return _days() * 86400


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def read_trusted_token(request: Request) -> str | None:
    return request.cookies.get(TRUSTED_COOKIE)


def set_trusted_cookie(response: Response, token: str) -> None:
    response.set_cookie(TRUSTED_COOKIE, token, max_age=_max_age(), **HOST_ATTRS)


def clear_trusted_cookie(response: Response) -> None:
    response.delete_cookie(TRUSTED_COOKIE, path="/", secure=True, httponly=True, samesite="lax")


def load_trusted(db: Session, token: str | None) -> TrustedDevice | None:
    if not token:
        return None
    row = db.scalar(select(TrustedDevice).where(TrustedDevice.token_hash == token_hash(token)))
    if not row or row.revoked_at is not None:
        return None
    exp = _aware(row.expires_at)
    if not exp or exp <= datetime.now(UTC):
        return None
    return row


def lookup_unlock(db: Session, request: Request, is_owner) -> tuple[TrustedDevice, User] | None:
    row = load_trusted(db, read_trusted_token(request))
    if not row:
        return None
    user = db.get(User, row.user_id)
    if not user or user.is_demo or not user.mfa_enabled or not is_owner(db, user.id):
        return None
    return row, user


def hint(db: Session, request: Request, is_owner) -> dict:
    found = lookup_unlock(db, request, is_owner)
    if not found:
        return {"available": False}
    _, user = found
    return {"available": True, "display_name": user.display_name}


def issue_or_refresh(db: Session, user: User, request: Request, response: Response, is_owner) -> None:
    if user.is_demo or not user.mfa_enabled or not is_owner(db, user.id):
        return
    now = datetime.now(UTC)
    existing = load_trusted(db, read_trusted_token(request))
    if existing and existing.user_id == user.id:
        existing.last_used_at = now
        existing.expires_at = now + timedelta(days=_days())
        existing.failures = 0
        existing.locked_until = None
        existing.user_agent = (request.headers.get("user-agent") or existing.user_agent or "")[:300]
        existing.ip_address = client_ip(request)
        existing.label = device_label(request.headers.get("user-agent"))
        set_trusted_cookie(response, read_trusted_token(request) or "")
        return
    rows = list(db.scalars(select(TrustedDevice).where(
        TrustedDevice.user_id == user.id, TrustedDevice.revoked_at.is_(None),
    ).order_by(TrustedDevice.last_used_at.asc().nullsfirst(), TrustedDevice.created_at.asc())).all())
    if len(rows) >= MAX_DEVICES:
        rows[0].revoked_at = now
    token = secrets.token_urlsafe(32)
    db.add(TrustedDevice(
        user_id=user.id,
        token_hash=token_hash(token),
        label=device_label(request.headers.get("user-agent")),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        ip_address=client_ip(request),
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(days=_days()),
    ))
    db.flush()
    set_trusted_cookie(response, token)


def unlock(db: Session, request: Request, response: Response, code: str, is_owner, new_session, set_session_cookie, me_view):
    found = lookup_unlock(db, request, is_owner)
    if not found:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in with your password")
    row, user = found
    now = datetime.now(UTC)
    settings = get_settings()
    locked = _aware(row.locked_until) or _aware(user.mfa_locked_until)
    if locked and locked > now:
        retry = int((locked - now).total_seconds())
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong codes. Try again later.",
                            headers={"Retry-After": str(max(1, retry))})
    counter = verify_totp(decrypt_field(user.mfa_secret_enc), code, user.mfa_last_counter) if user.mfa_secret_enc else None
    if counter is None:
        row.failures += 1
        user.mfa_failures = (user.mfa_failures or 0) + 1
        audit(db, workspace_id=None, user_id=user.id, action="user.mfa.failed", entity="user",
              entity_id=user.id, detail={"trusted_device": True})
        if row.failures >= MFA_MAX_FAILURES or user.mfa_failures >= MFA_MAX_FAILURES:
            lock_for = timedelta(minutes=settings.lockout_minutes)
            row.failures = 0
            row.locked_until = now + lock_for
            user.mfa_failures = 0
            user.mfa_locked_until = now + lock_for
            audit(db, workspace_id=None, user_id=user.id, action="user.mfa_locked", entity="user",
                  entity_id=user.id, detail={"trusted_device": True})
            db.flush()
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong codes. Try again later.",
                                headers={"Retry-After": str(settings.lockout_minutes * 60)})
        db.flush()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code didn't work")
    user.mfa_last_counter = counter
    user.mfa_failures = 0
    user.mfa_locked_until = None
    row.failures = 0
    row.locked_until = None
    row.last_used_at = now
    row.expires_at = now + timedelta(days=_days())
    token = new_session(db, user.id)
    audit(db, workspace_id=None, user_id=user.id, action="user.login", entity="user",
          entity_id=user.id, detail={"mfa": True, "trusted_device": True})
    db.flush()
    set_trusted_cookie(response, read_trusted_token(request) or "")
    set_session_cookie(response, token)
    return me_view(db, user)


def list_devices(db: Session, user: User, request: Request) -> list[dict]:
    rows = list(db.scalars(select(TrustedDevice).where(
        TrustedDevice.user_id == user.id, TrustedDevice.revoked_at.is_(None),
    ).order_by(TrustedDevice.last_used_at.desc().nullslast(), TrustedDevice.created_at.desc())).all())
    current = load_trusted(db, read_trusted_token(request))
    now = datetime.now(UTC)
    out = []
    for row in rows:
        exp = _aware(row.expires_at)
        if exp and exp <= now:
            continue
        out.append({
            "id": row.id,
            "label": row.label,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "current": bool(current and current.id == row.id),
        })
    return out


def revoke_one(db: Session, user: User, device_id: str, request: Request, response: Response) -> None:
    row = db.get(TrustedDevice, device_id)
    if not row or row.user_id != user.id or row.revoked_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    row.revoked_at = datetime.now(UTC)
    raw = read_trusted_token(request)
    if raw and token_hash(raw) == row.token_hash:
        clear_trusted_cookie(response)
    audit(db, workspace_id=None, user_id=user.id, action="auth.trusted_device.revoked",
          entity="user", entity_id=user.id, detail={"device_id": row.id})


def revoke_all(db: Session, user: User, request: Request, response: Response) -> int:
    n = revoke_all_for_user(db, user.id)
    clear_trusted_cookie(response)
    audit(db, workspace_id=None, user_id=user.id, action="auth.trusted_device.revoked_all",
          entity="user", entity_id=user.id, detail={"count": n})
    return n


def revoke_all_for_user(db: Session, user_id: str) -> int:
    now = datetime.now(UTC)
    n = 0
    for row in db.scalars(select(TrustedDevice).where(
        TrustedDevice.user_id == user_id, TrustedDevice.revoked_at.is_(None),
    )).all():
        row.revoked_at = now
        n += 1
    return n
