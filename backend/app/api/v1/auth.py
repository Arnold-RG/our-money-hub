from __future__ import annotations

import secrets
import time
import uuid
from collections import OrderedDict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import CURRENCIES
from app.core.permissions import current_user
from app.core.security import (COOKIE_NAME, decrypt_field, encrypt_field, hash_password, load_session, new_session,
                               new_totp_secret, revoke, verify_password, verify_totp)
from app.database.models import User
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.workspaces.service import bootstrap_user_workspaces, user_workspaces

router = APIRouter(prefix="/auth", tags=["auth"])
DEMO_DOMAIN = "demo.ourmoneyhub.local"
MFA_MAX_FAILURES = 5


class _IpThrottle:
    """Bounded per-IP throttle for registration/login bursts (account lockout is in the database)."""

    def __init__(self, limit: int = 30, window: int = 300, max_keys: int = 10_000):
        self.limit, self.window, self.max_keys = limit, window, max_keys
        self.hits: OrderedDict[str, list[float]] = OrderedDict()

    def check(self, key: str) -> None:
        now = time.time()
        hits = [t for t in self.hits.pop(key, []) if now - t < self.window]
        if len(hits) >= self.limit:
            self.hits[key] = hits
            raise HTTPException(429, "Too many attempts from this network. Wait a few minutes.")
        hits.append(now)
        self.hits[key] = hits
        while len(self.hits) > self.max_keys:
            self.hits.popitem(last=False)

    def clear(self) -> None:
        self.hits.clear()


throttle = _IpThrottle()


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=200)
    display_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    reporting_currency: str | None = None


def me_view(db: Session, u: User) -> dict:
    return {"id": u.id, "email": u.email, "display_name": u.display_name, "is_demo": u.is_demo,
            "reporting_currency": u.reporting_currency, "mfa_enabled": u.mfa_enabled,
            "workspaces": [{"id": w.id, "name": w.name, "kind": w.kind, "base_currency": w.base_currency, "role": r}
                           for w, r in user_workspaces(db, u.id)]}


def _set_cookie(resp: Response, token: str, minutes: int | None = None) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE_NAME, token, httponly=True, samesite="lax", secure=s.cookie_secure,
                    max_age=(minutes or s.access_token_minutes) * 60, path="/")


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def demo_enabled() -> bool:
    s = get_settings()
    return s.demo_login_enabled and s.app_env == "development"


@router.get("/config")
def auth_config():
    return {"demo_login": demo_enabled(), "mfa": "totp"}


@router.post("/register")
def register(body: RegisterIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    throttle.check(f"reg:{_ip(request)}")
    email = body.email.lower()
    if email.endswith("@" + DEMO_DOMAIN) or db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    u = User(email=email, display_name=body.display_name.strip(), password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    bootstrap_user_workspaces(db, u)
    audit(db, workspace_id=None, user_id=u.id, action="user.registered", entity="user", entity_id=u.id)
    token = new_session(db, u.id)
    db.commit()
    _set_cookie(resp, token)
    return me_view(db, u)


@router.post("/login")
def login(body: LoginIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    throttle.check(f"login:{_ip(request)}")
    s = get_settings()
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    now = datetime.now(UTC)
    if u and u.locked_until and _aware(u.locked_until) > now:
        verify_password(body.password, None)  # same work either way
        raise HTTPException(423, "Too many failed attempts. This account is locked for a few minutes.")
    ok = verify_password(body.password, u.password_hash if u and not u.is_demo else None)
    if not ok:
        if u and not u.is_demo:
            u.failed_logins += 1
            if u.failed_logins >= s.lockout_attempts:
                u.locked_until = now + timedelta(minutes=s.lockout_minutes)
                u.failed_logins = 0
                audit(db, workspace_id=None, user_id=u.id, action="user.locked", entity="user", entity_id=u.id)
            db.commit()
        raise HTTPException(401, "Email or password is incorrect")
    u.failed_logins, u.locked_until = 0, None
    if u.mfa_enabled:
        token = new_session(db, u.id, mfa_pending=True)
        db.commit()
        _set_cookie(resp, token, 10)
        return {"mfa_required": True}
    token = new_session(db, u.id)
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id)
    db.commit()
    _set_cookie(resp, token)
    return me_view(db, u)


@router.post("/mfa/verify")
def mfa_verify(body: CodeIn, request: Request, resp: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    sess = load_session(db, token, allow_mfa_pending=True)
    if not sess or not sess.mfa_pending:
        raise HTTPException(401, "Sign in again")
    u = db.get(User, sess.user_id)
    counter = verify_totp(decrypt_field(u.mfa_secret_enc), body.code, u.mfa_last_counter) if u.mfa_secret_enc else None
    if counter is None:
        sess.mfa_failures += 1
        if sess.mfa_failures >= MFA_MAX_FAILURES:
            sess.revoked_at = datetime.now(UTC)
            audit(db, workspace_id=None, user_id=u.id, action="user.mfa_locked", entity="user", entity_id=u.id)
        db.commit()
        raise HTTPException(401, "That code didn't work")
    u.mfa_last_counter = counter
    sess.revoked_at = datetime.now(UTC)
    full = new_session(db, u.id)
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id, detail={"mfa": True})
    db.commit()
    _set_cookie(resp, full)
    return me_view(db, u)


@router.post("/mfa/setup")
def mfa_setup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.is_demo:
        raise HTTPException(403, "Not available in the demo")
    if user.mfa_enabled:
        raise HTTPException(409, "Two-step sign-in is already on")
    secret = new_totp_secret()
    user.mfa_secret_enc = encrypt_field(secret)
    db.commit()
    import pyotp

    return {"secret": secret, "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Our Money Hub")}


@router.post("/mfa/enable")
def mfa_enable(body: CodeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.mfa_secret_enc:
        raise HTTPException(409, "Start setup first")
    counter = verify_totp(decrypt_field(user.mfa_secret_enc), body.code, user.mfa_last_counter)
    if counter is None:
        raise HTTPException(422, "That code didn't work")
    user.mfa_enabled, user.mfa_last_counter = True, counter
    audit(db, workspace_id=None, user_id=user.id, action="user.mfa_enabled", entity="user", entity_id=user.id)
    db.commit()
    return me_view(db, user)


@router.post("/demo")
def demo(resp: Response, request: Request, db: Session = Depends(get_db)):
    """Private, EMPTY throwaway workspace per visitor (no sample figures). Development only, off by default."""
    if not demo_enabled():
        raise HTTPException(404, "Demo login is disabled")
    throttle.check(f"demo:{_ip(request)}")
    u = User(email=f"demo-{uuid.uuid4().hex[:12]}@{DEMO_DOMAIN}", display_name="Demo", is_demo=True,
             password_hash=hash_password(secrets.token_urlsafe(32)))
    db.add(u)
    db.flush()
    bootstrap_user_workspaces(db, u)
    token = new_session(db, u.id)
    db.commit()
    _set_cookie(resp, token)
    return me_view(db, u)


@router.post("/logout")
def logout(request: Request, resp: Response, db: Session = Depends(get_db)):
    revoke(db, request.cookies.get(COOKIE_NAME))
    db.commit()
    resp.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_view(db, user)


@router.patch("/me")
def update_me(body: MeUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.display_name:
        user.display_name = body.display_name.strip()
    if body.reporting_currency:
        cur = body.reporting_currency.upper()
        if cur not in CURRENCIES:
            raise HTTPException(422, "Unsupported currency")
        user.reporting_currency = cur
    db.commit()
    return me_view(db, user)
