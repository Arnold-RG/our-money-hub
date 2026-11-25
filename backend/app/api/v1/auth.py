from __future__ import annotations

import hmac
import secrets
import time
import uuid
from collections import OrderedDict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.emails import EmailAddress
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import invites, oauth_github, usernames
from app.modules import auth_support
from app.database.models import AuthIdentity, FinancialWorkspace, InstanceSetting, User, UserSession, WorkspaceMember
from app.core.client_ip import client_ip
from app.core.config import get_settings
from app.core.money import CURRENCIES
from app.core.passwords import hibp_pwned_count, validate_password
from app.core.permissions import current_enrolment, current_user, require_recent_auth
from app.core.ratelimit import backoff_state, clear_backoff, hit, record_failure
from app.core.security import (COOKIE_NAME, LEGACY_COOKIE_NAME, decrypt_field, encrypt_field, hash_password,
                               load_session, needs_rehash, new_session, new_totp_secret, read_token, revoke,
                               token_hash, verify_password, verify_totp)
from app.database.models import FinancialWorkspace, InstanceSetting, User, UserSession, WorkspaceMember
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.workspaces.service import bootstrap_user_workspaces, user_workspaces

router = APIRouter(prefix="/auth", tags=["auth"])
DEMO_DOMAIN = "demo.ourmoneyhub.local"
MFA_MAX_FAILURES = 5


class RegisterIn(BaseModel):
    setup_token: str | None = Field(default=None, max_length=200)
    invite_token: str | None = Field(default=None, max_length=200)
    email: EmailAddress
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)


class LoginIn(BaseModel):
    password: str = Field(max_length=128)
    identifier: str | None = Field(default=None, max_length=320)
    email: str | None = Field(default=None, max_length=320)

    def login_id(self) -> str:
        return (self.identifier or self.email or "").strip()


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class RecoveryIn(BaseModel):
    code: str = Field(min_length=8, max_length=16)


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    reporting_currency: str | None = None


def me_view(db: Session, u: User) -> dict:
    return {"id": u.id, "email": u.email, "username": u.username, "display_name": u.display_name, "is_demo": u.is_demo,
            "reporting_currency": u.reporting_currency, "mfa_enabled": u.mfa_enabled,
            "has_password": bool(u.password_hash),
            "workspaces": [{"id": w.id, "name": w.name, "kind": w.kind, "base_currency": w.base_currency, "role": r}
                           for w, r in user_workspaces(db, u.id)]}


HOST_ATTRS = dict(httponly=True, secure=True, samesite="lax", path="/")


def _set_cookie(resp: Response, token: str, minutes: int | None = None) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE_NAME, token, max_age=(minutes or s.access_token_minutes) * 60, **HOST_ATTRS)
    if LEGACY_COOKIE_NAME != COOKIE_NAME:
        resp.delete_cookie(LEGACY_COOKIE_NAME, path="/")


def _clear_cookie(resp: Response) -> None:
    resp.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax")
    resp.delete_cookie(LEGACY_COOKIE_NAME, path="/")


GENERIC_LOGIN = "Email or password is incorrect"
GENERIC_LOCK = "Too many attempts. Try again later."



def _set_invite_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(invites.INVITE_COOKIE, token, max_age=invites.INVITE_COOKIE_MAX_AGE, **HOST_ATTRS)


def _clear_invite_cookie(resp: Response) -> None:
    resp.delete_cookie(invites.INVITE_COOKIE, path="/", secure=True, httponly=True, samesite="lax")


def _http_retry(status: int, detail: str, retry: int | None = None) -> HTTPException:
    headers = {"Retry-After": str(retry)} if retry else None
    return HTTPException(status, detail, headers=headers)


def _owner_setup_pending(db: Session) -> bool:
    s = get_settings()
    if not s.omh_owner_setup_token:
        return False
    if db.get(InstanceSetting, "owner_bootstrapped"):
        return False
    return db.scalar(select(func.count()).select_from(User).where(User.is_demo.is_(False))) == 0


def _user_is_owner(db: Session, user_id: str) -> bool:
    return db.scalar(select(WorkspaceMember).where(
        WorkspaceMember.user_id == user_id, WorkspaceMember.role == "owner")) is not None


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def demo_enabled() -> bool:
    s = get_settings()
    return s.demo_login_enabled and s.app_env == "development"





@router.get("/config")
def auth_config(db: Session = Depends(get_db)):
    s = get_settings()
    return {
        "app": "omh",
        "demo_login": demo_enabled(),
        "mfa": "totp",
        "registration_mode": s.registration_mode,
        "owner_setup": _owner_setup_pending(db),
        "providers": {"github": bool(s.github_client_id)},
        "password_reset": "email",
        "email_verification": bool(s.email_verification_enabled),
        "private": not (s.app_env in {"development", "test"}),
        "signup_enabled": s.app_env in {"development", "test"} and s.registration_mode == "open",
    }


@router.post("/register")
def register(body: RegisterIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    allowed, retry = hit(db, f"register:ip:{ip}", 5, 3600)
    if not allowed:
        raise _http_retry(429, GENERIC_LOCK, retry)
    setup_ok = bool(
        _owner_setup_pending(db) and body.setup_token and s.omh_owner_setup_token
        and len(s.omh_owner_setup_token) >= 32
        and hmac.compare_digest(body.setup_token.encode(), s.omh_owner_setup_token.encode())
    )
    invite_raw = (body.invite_token or request.cookies.get(invites.INVITE_COOKIE) or "").strip() or None
    invite_flow = (not setup_ok) and s.registration_mode == "invite" and bool(invite_raw)
    open_flow = (not setup_ok) and (not invite_flow) and s.registration_mode == "open"
    if not setup_ok and s.app_env not in {"development", "test"}:
        raise HTTPException(403, "This app is private.")
    if not setup_ok and not invite_flow and not open_flow:
        raise HTTPException(403, invites.GENERIC if invite_raw else "Registration is closed. Ask the owner for an invite.")
    try:
        username = usernames.validate_username(body.username)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        validate_password(body.password, email=body.email, name=body.display_name)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    count, breach = hibp_pwned_count(body.password)
    if breach == "pwned":
        raise HTTPException(422, "Please choose a different password. This one appears in a known data breach.")
    email = body.email.lower()
    invite_row = None
    if invite_raw and s.registration_mode == "invite":
        try:
            invite_row = invites.consume(db, invite_raw, email)
        except ValueError as exc:
            raise HTTPException(403, str(exc)) from exc
        invite_flow = True
    if email.endswith("@" + DEMO_DOMAIN) or db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    if not usernames.is_available(db, User, username):
        raise HTTPException(409, "That username is not available")
    u = User(email=email, username=username, display_name=body.display_name.strip(), password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    if invite_flow and invite_row.workspace_id:
        db.add(WorkspaceMember(workspace_id=invite_row.workspace_id, user_id=u.id, role=invite_row.role or "viewer"))
    else:
        bootstrap_user_workspaces(db, u)
    auth_support.ensure_instance_owner(db, u)
    if setup_ok:
        db.add(InstanceSetting(key="owner_bootstrapped", value="1"))
        try:
            db.flush()
        except Exception:
            db.rollback()
            raise HTTPException(409, "Owner setup has already been used")
    from app.core.recovery_codes import issue_codes
    codes = issue_codes(db, u.id)
    enrol = _user_is_owner(db, u.id)
    audit(db, workspace_id=None, user_id=u.id, action="user.registered", entity="user", entity_id=u.id,
          detail={"breach_check": breach, "owner_setup": setup_ok, "invite": bool(invite_flow)})
    if invite_flow:
        audit(db, workspace_id=invite_row.workspace_id, user_id=u.id, action="auth.invite.accepted",
              entity="user", entity_id=u.id, detail={"role": invite_row.role})
    token = new_session(db, u.id, enrolment_required=enrol)
    db.commit()
    _set_cookie(resp, token, s.mfa_pending_minutes if enrol else None)
    if invite_flow:
        _clear_invite_cookie(resp)
    if enrol:
        return {"mfa_required": False, "mfa_enrolment_required": True, "recovery_codes": codes}
    view = me_view(db, u)
    view["recovery_codes"] = codes
    return view


@router.post("/login")
def login(body: LoginIn, resp: Response, request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    ident = body.login_id()
    key, u = auth_support.lookup_user(db, ident)
    email = key or ident.lower()
    allowed, retry = hit(db, f"login:ip:{ip}", 20, 300)
    if not allowed:
        raise _http_retry(429, GENERIC_LOCK, retry)
    allowed, retry = hit(db, f"login:acct-ip:{email}:{ip}", 10, 900)
    if not allowed:
        raise _http_retry(429, GENERIC_LOCK, retry)
    blocked, retry = backoff_state(db, f"login:email:{email}")
    if blocked:
        raise _http_retry(429, GENERIC_LOCK, retry)
    ok = verify_password(body.password, u.password_hash if u and not u.is_demo and u.password_hash else None)
    if not ok:
        record_failure(db, f"login:email:{email}")
        if u and not u.is_demo:
            u.failed_logins += 1
            audit(db, workspace_id=None, user_id=u.id, action="user.login.failed", entity="user", entity_id=u.id)
        db.commit()
        raise HTTPException(401, GENERIC_LOGIN)
    u.failed_logins, u.locked_until = 0, None
    clear_backoff(db, f"login:email:{email}")
    if needs_rehash(u.password_hash):
        u.password_hash = hash_password(body.password)
    enrol = (not u.mfa_enabled) and _user_is_owner(db, u.id)
    if u.mfa_enabled:
        token = new_session(db, u.id, mfa_pending=True)
        db.commit()
        _set_cookie(resp, token, s.mfa_pending_minutes)
        return {"mfa_required": True, "mfa_enrolment_required": False}
    token = new_session(db, u.id, enrolment_required=enrol)
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id)
    db.commit()
    _set_cookie(resp, token, s.mfa_pending_minutes if enrol else None)
    if enrol:
        return {"mfa_required": False, "mfa_enrolment_required": True}
    return me_view(db, u)


@router.post("/mfa/verify")
def mfa_verify(body: CodeIn, request: Request, resp: Response, db: Session = Depends(get_db)):
    token = read_token(request)
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
def mfa_setup(user: User = Depends(current_enrolment), db: Session = Depends(get_db)):
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
def mfa_enable(body: CodeIn, request: Request, resp: Response, user: User = Depends(current_enrolment), db: Session = Depends(get_db)):
    if not user.mfa_secret_enc:
        raise HTTPException(409, "Start setup first")
    counter = verify_totp(decrypt_field(user.mfa_secret_enc), body.code, user.mfa_last_counter)
    if counter is None:
        raise HTTPException(422, "That code didn't work")
    user.mfa_enabled, user.mfa_last_counter = True, counter
    from app.core.recovery_codes import issue_codes
    codes = issue_codes(db, user.id)
    # rotate the enrolment session into a full session
    prev = load_session(db, read_token(request), allow_enrolment=True)
    if prev:
        prev.revoked_at = datetime.now(UTC)
        prev.enrolment_required = False
    token = new_session(db, user.id)
    audit(db, workspace_id=None, user_id=user.id, action="user.mfa_enabled", entity="user", entity_id=user.id)
    db.commit()
    _set_cookie(resp, token)
    view = me_view(db, user)
    view["recovery_codes"] = codes
    view["mfa_enrolment_required"] = False
    return view


@router.post("/mfa/recovery")
def mfa_recovery(body: RecoveryIn, request: Request, resp: Response, db: Session = Depends(get_db)):
    token = read_token(request)
    sess = load_session(db, token, allow_mfa_pending=True)
    if not sess or not sess.mfa_pending:
        raise HTTPException(401, "Sign in again")
    u = db.get(User, sess.user_id)
    from app.core.recovery_codes import consume_code
    if not u or not consume_code(db, u.id, body.code):
        if sess:
            sess.mfa_failures += 1
            if sess.mfa_failures >= MFA_MAX_FAILURES:
                sess.revoked_at = datetime.now(UTC)
                if u:
                    audit(db, workspace_id=None, user_id=u.id, action="user.mfa_locked", entity="user", entity_id=u.id)
            db.commit()
        raise HTTPException(401, "That backup code didn't match")
    sess.revoked_at = datetime.now(UTC)
    full = new_session(db, u.id)
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id, detail={"mfa": "recovery"})
    db.commit()
    _set_cookie(resp, full)
    return me_view(db, u)


@router.post("/demo")
def demo(resp: Response, request: Request, db: Session = Depends(get_db)):
    """Private, EMPTY throwaway workspace per visitor (no sample figures). Development only, off by default."""
    if not demo_enabled():
        raise HTTPException(404, "Demo login is disabled")
    allowed, retry = hit(db, f"demo:ip:{client_ip(request)}", 20, 300)
    if not allowed:
        raise _http_retry(429, GENERIC_LOCK, retry)
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
    revoke(db, read_token(request))
    db.commit()
    _clear_cookie(resp)
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



class PasswordResetRequest(BaseModel):
    identifier: str | None = Field(default=None, max_length=320)
    email: str | None = Field(default=None, max_length=320)

    def login_id(self) -> str:
        return (self.identifier or self.email or "").strip()


class PasswordResetConfirm(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=12, max_length=128)


class PasswordRecoveryReset(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    recovery_code: str = Field(min_length=8, max_length=16)
    password: str = Field(min_length=12, max_length=128)


class PasswordSetIn(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class OAuthCallbackIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    state: str = Field(min_length=1, max_length=200)


def _set_oauth_cookie(resp: Response, value: str) -> None:
    resp.set_cookie("__Host-omh_oauth", value, max_age=600, **HOST_ATTRS)


def _clear_oauth_cookie(resp: Response) -> None:
    resp.delete_cookie("__Host-omh_oauth", path="/", secure=True, httponly=True, samesite="lax")


def _finish_login(db: Session, u: User, resp: Response, *, method: str):
    s = get_settings()
    enrol = (not u.mfa_enabled) and auth_support.is_owner(db, u)
    if u.mfa_enabled:
        token = new_session(db, u.id, mfa_pending=True)
        db.commit()
        _set_cookie(resp, token, s.mfa_pending_minutes)
        return {"mfa_required": True, "mfa_enrolment_required": False, "user": None}
    token = new_session(db, u.id, enrolment_required=enrol)
    audit(db, workspace_id=None, user_id=u.id, action="user.login", entity="user", entity_id=u.id, detail={"method": method})
    db.commit()
    _set_cookie(resp, token, s.mfa_pending_minutes if enrol else None)
    if enrol:
        return {"mfa_required": False, "mfa_enrolment_required": True, "user": None}
    return {"mfa_required": False, "mfa_enrolment_required": False, "user": me_view(db, u)}


@router.post("/oauth/github/start")
def oauth_github_start(resp: Response):
    s = get_settings()
    if not s.github_client_id or not s.github_client_secret:
        raise HTTPException(503, "GitHub sign-in is not configured yet")
    try:
        _state, cookie, url = oauth_github.new_pkce_state()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    _set_oauth_cookie(resp, cookie)
    return {"authorization_url": url}


@router.post("/oauth/github/callback")
def oauth_github_callback(body: OAuthCallbackIn, request: Request, resp: Response, db: Session = Depends(get_db)):
    s = get_settings()
    if not s.github_client_id or not s.github_client_secret:
        raise HTTPException(503, "GitHub sign-in is not configured yet")
    verifier = oauth_github.parse_cookie(request.cookies.get("__Host-omh_oauth") or "", body.state)
    _clear_oauth_cookie(resp)
    if not verifier:
        raise HTTPException(400, "GitHub sign-in could not be completed")
    try:
        result = oauth_github.exchange(body.code, verifier)
    except Exception as exc:
        raise HTTPException(400, "GitHub sign-in could not be completed") from exc
    profile = result.get("profile") or {}
    if not oauth_github.is_allowed_github_account(profile):
        raise HTTPException(403, "This app is private.")
    primary = result.get("primary_email") or {}
    email = (primary.get("email") or "").strip().lower()
    if not email or not primary.get("verified"):
        raise HTTPException(403, "GitHub sign-in needs a verified primary email")
    subject = str(profile.get("id") or "")
    identity = db.scalar(select(AuthIdentity).where(AuthIdentity.provider == "github", AuthIdentity.subject == subject))
    owner = auth_support.instance_owner(db)
    if owner is None:
        raise HTTPException(403, "This app is private.")
    user = db.get(User, identity.user_id) if identity else owner
    if user is None or not auth_support.is_owner(db, user) or (identity and identity.user_id != owner.id):
        raise HTTPException(403, "This app is private.")
    if not identity:
        db.add(AuthIdentity(user_id=owner.id, provider="github", subject=subject, email=email, email_verified=True))
        user = owner
    return _finish_login(db, user, resp, method="github")


@router.post("/oauth/{provider}/start")
def oauth_start(provider: str):
    raise HTTPException(404, "Unknown provider")


@router.post("/email/verify")
def email_verify():
    if not get_settings().email_verification_enabled:
        raise HTTPException(404, "Email verification is not enabled")
    raise HTTPException(503, "No email provider is connected")


@router.post("/email/resend")
def email_resend():
    if not get_settings().email_verification_enabled:
        raise HTTPException(404, "Email verification is not enabled")
    raise HTTPException(503, "No email provider is connected")


@router.post("/password/forgot", status_code=202)
def password_forgot(body: PasswordResetRequest, request: Request, db: Session = Depends(get_db)):
    try:
        return auth_support.request_code(db, body.login_id(), request)
    except auth_support.ResetError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(exc.status, str(exc), headers=headers) from exc


@router.post("/password/reset")
def password_reset(body: PasswordResetConfirm, request: Request, db: Session = Depends(get_db)):
    try:
        auth_support.confirm_code(db, body.identifier, body.code, body.password, request)
    except auth_support.ResetError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(exc.status, str(exc), headers=headers) from exc
    return {"status": "ok"}


@router.post("/password/recovery")
def password_reset_recovery(body: PasswordRecoveryReset, request: Request, db: Session = Depends(get_db)):
    try:
        auth_support.confirm_recovery(db, body.identifier, body.recovery_code, body.password, request)
    except auth_support.ResetError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(exc.status, str(exc), headers=headers) from exc
    return {"status": "ok"}


@router.post("/password/set")
def password_set(body: PasswordSetIn, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_recent_auth())):
    if not auth_support.is_owner(db, user):
        raise HTTPException(403, "This app is private.")
    try:
        auth_support.set_password(db, user, body.password)
    except auth_support.ResetError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return {"status": "ok", "user": me_view(db, user)}


@router.post("/recovery", status_code=202)
def recovery(body: PasswordResetRequest, request: Request, db: Session = Depends(get_db)):
    """Backward-compatible alias of /password/forgot."""
    return password_forgot(body, request, db)



class InvitePreviewIn(BaseModel):
    token: str | None = Field(default=None, max_length=200)


class InviteCreateIn(BaseModel):
    email: EmailAddress
    role: str = "viewer"
    workspace_id: str


@router.post("/invite/preview")
def invite_preview(request: Request, resp: Response, db: Session = Depends(get_db),
                   body: InvitePreviewIn | None = None):
    if get_settings().registration_mode != "invite":
        raise HTTPException(403, invites.GENERIC)
    raw = ((body.token if body else None) or request.cookies.get(invites.INVITE_COOKIE) or "").strip()
    row = invites.lookup(db, raw)
    if not invites.is_usable(row):
        _clear_invite_cookie(resp)
        raise HTTPException(403, invites.GENERIC)
    _set_invite_cookie(resp, raw)
    return invites.preview(db, row)


@router.post("/invites")
def create_invite(body: InviteCreateIn, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_recent_auth())):
    # Must be an owner of the target workspace.
    m = db.scalar(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == body.workspace_id, WorkspaceMember.user_id == user.id))
    if not m or m.role != "owner":
        raise HTTPException(403, "Only a workspace owner can create invites")
    if get_settings().registration_mode != "invite":
        raise HTTPException(403, "Set registration mode to invite before creating invites")
    try:
        raw = invites.issue(db, email=str(body.email), role=body.role,
                            workspace_id=body.workspace_id, created_by=user.id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit(db, workspace_id=body.workspace_id, user_id=user.id, action="auth.invite.created",
          entity="user", entity_id=user.id, detail={"email": str(body.email).lower(), "role": body.role})
    db.commit()
    base = get_settings().public_base_url.rstrip("/")
    return {"email": str(body.email).lower(), "role": body.role, "workspace_id": body.workspace_id,
            "expires_in_hours": 72, "invite_url": f"{base}/invite#{raw}", "token": raw}
