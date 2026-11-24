from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import CURRENCIES
from app.core.permissions import current_user
from app.core.security import COOKIE_NAME, create_token, hash_password, verify_password
from app.database.models import User
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.workspaces.service import bootstrap_user_workspaces, user_workspaces

router = APIRouter(prefix="/auth", tags=["auth"])
_attempts: dict[str, list[float]] = defaultdict(list)
DEMO_EMAIL = "demo@ourmoneyhub.local"


def _throttle(key: str, limit: int = 8, window: int = 300) -> None:
    now = time.time()
    _attempts[key] = [t for t in _attempts[key] if now - t < window]
    if len(_attempts[key]) >= limit:
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    _attempts[key].append(now)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    display_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    reporting_currency: str | None = None


def me_view(db: Session, u: User) -> dict:
    return {"id": u.id, "email": u.email, "display_name": u.display_name, "is_demo": u.is_demo,
            "reporting_currency": u.reporting_currency,
            "workspaces": [{"id": w.id, "name": w.name, "kind": w.kind, "base_currency": w.base_currency, "role": r}
                           for w, r in user_workspaces(db, u.id)]}


def _set_cookie(resp: Response, user: User) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE_NAME, create_token(user.id), httponly=True, samesite="lax", secure=s.cookie_secure,
                    max_age=s.access_token_minutes * 60, path="/")


@router.post("/register")
def register(body: RegisterIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    _throttle(f"reg:{request.client.host if request.client else '?'}")
    email = body.email.lower()
    if email == DEMO_EMAIL or db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    u = User(email=email, display_name=body.display_name.strip(), password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    bootstrap_user_workspaces(db, u)
    audit(db, workspace_id=None, user_id=u.id, action="user.registered", entity="user", entity_id=u.id)
    db.commit()
    _set_cookie(resp, u)
    return me_view(db, u)


@router.post("/login")
def login(body: LoginIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    _throttle(f"login:{body.email.lower()}")
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    if not u or u.is_demo or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id)
    db.commit()
    _set_cookie(resp, u)
    return me_view(db, u)


@router.post("/demo")
def demo(resp: Response, db: Session = Depends(get_db)):
    """Sign in to an EMPTY demo workspace (no sample figures). Disabled outside development."""
    if not get_settings().demo_login_enabled:
        raise HTTPException(404, "Demo login is disabled")
    u = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if not u:
        import secrets

        u = User(email=DEMO_EMAIL, display_name="Demo", is_demo=True, password_hash=hash_password(secrets.token_urlsafe(32)))
        db.add(u)
        db.flush()
        bootstrap_user_workspaces(db, u)
        db.commit()
    _set_cookie(resp, u)
    return me_view(db, u)


@router.post("/logout")
def logout(resp: Response):
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
