from __future__ import annotations

from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from app.core import oauth_github
from app.core.config import get_settings
from app.core.recovery_codes import issue_codes
from app.database.models import PasswordResetCode, User, WorkspaceMember
from tests.conftest import _client, register, username_for

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)
PASSWORD = "correct-horse-battery"


def test_login_accepts_username(api):
    c = _client()
    r = c.post("/api/v1/auth/login", json={"identifier": username_for("owner@example.com"), "password": PASSWORD})
    # owner is enrolled in the api fixture, so MFA is required
    assert r.status_code == 200, r.text
    assert r.json()["mfa_required"] is True


def test_auth_config_is_private_github_only():
    c = _client()
    cfg = c.get("/api/v1/auth/config").json()
    assert cfg["providers"] == {"github": False}
    assert cfg["password_reset"] == "email"
    assert "signup_enabled" in cfg and "private" in cfg


def test_google_and_apple_oauth_are_gone():
    c = _client()
    assert c.post("/api/v1/auth/oauth/google/start").status_code == 404
    assert c.post("/api/v1/auth/oauth/apple/start").status_code == 404
    assert c.post("/api/v1/auth/oauth/github/start").status_code == 503


def test_password_reset_email_code_is_generic_and_single_use(api, db):
    c = _client()
    missing = c.post("/api/v1/auth/password/forgot", json={"identifier": "nobody@example.com"})
    exists = c.post("/api/v1/auth/password/forgot", json={"identifier": "owner@example.com"})
    assert missing.status_code == 202 and exists.status_code == 202
    assert missing.json()["message"] == exists.json()["message"]

    db.expire_all()
    owner = db.query(User).filter(User.email == "owner@example.com").one()
    for row in db.query(PasswordResetCode).filter(PasswordResetCode.user_id == owner.id).all():
        row.used_at = datetime.now(UTC)
    known = "123456"
    db.add(PasswordResetCode(
        user_id=owner.id, code_hash=_hasher.hash(known),
        expires_at=datetime.now(UTC) + timedelta(minutes=15),
    ))
    db.commit()
    assert c.post("/api/v1/auth/password/reset", json={
        "identifier": "owner@example.com", "code": "123456", "password": "new-horse-battery-1",
    }).status_code == 200
    assert c.post("/api/v1/auth/password/reset", json={
        "identifier": "owner@example.com", "code": "123456", "password": "new-horse-battery-2",
    }).status_code == 400
    fresh = _client()
    logged = fresh.post("/api/v1/auth/login", json={"identifier": "owner@example.com", "password": "new-horse-battery-1"})
    assert logged.status_code == 200
    assert logged.json()["mfa_required"] is True


def test_password_reset_rejected_for_non_owner(api, db):
    # A second user in test/open mode is not an owner
    other, _ = register("viewer@example.com", "Viewer", enrol=False)
    c = _client()
    r = c.post("/api/v1/auth/password/forgot", json={"identifier": "viewer@example.com"})
    assert r.status_code == 202
    db.expire_all()
    viewer = db.query(User).filter(User.email == "viewer@example.com").one()
    assert db.query(PasswordResetCode).filter(PasswordResetCode.user_id == viewer.id).count() == 0


def test_password_reset_with_recovery_code(api, db):
    owner = db.query(User).filter(User.email == "owner@example.com").one()
    codes = issue_codes(db, owner.id)
    db.commit()
    c = _client()
    r = c.post("/api/v1/auth/password/recovery", json={
        "identifier": "owner@example.com", "recovery_code": codes[0], "password": "recovery-battery-99",
    })
    assert r.status_code == 200, r.text
    assert c.post("/api/v1/auth/password/recovery", json={
        "identifier": "owner@example.com", "recovery_code": codes[0], "password": "recovery-battery-00",
    }).status_code == 400
    fresh = _client()
    logged = fresh.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": "recovery-battery-99"})
    assert logged.status_code == 200
    assert logged.json()["mfa_required"] is True


def test_github_rejects_any_other_account(monkeypatch, api):
    s = get_settings()
    monkeypatch.setattr(s, "github_client_id", "test-id")
    monkeypatch.setattr(s, "github_client_secret", "test-secret")
    def _exchange(code, verifier):
        return {
            "profile": {"id": "1", "login": "someone-else"},
            "primary_email": {"email": "else@example.com", "verified": True},
        }
    monkeypatch.setattr(oauth_github, "parse_cookie", lambda blob, state: "verifier")
    monkeypatch.setattr(oauth_github, "exchange", _exchange)
    c = _client()
    r = c.post("/api/v1/auth/oauth/github/callback", json={"code": "x", "state": "y"})
    assert r.status_code == 403
    assert r.json()["detail"] == "This app is private."


def test_github_signs_in_allowlisted_owner(monkeypatch, api, db):
    s = get_settings()
    monkeypatch.setattr(s, "github_client_id", "test-id")
    monkeypatch.setattr(s, "github_client_secret", "test-secret")
    def _exchange(code, verifier):
        return {
            "profile": {"id": "137049568", "login": "Arnold-RG"},
            "primary_email": {"email": "arnold@example.com", "verified": True},
        }
    monkeypatch.setattr(oauth_github, "parse_cookie", lambda blob, state: "verifier")
    monkeypatch.setattr(oauth_github, "exchange", _exchange)
    c = _client()
    r = c.post("/api/v1/auth/oauth/github/callback", json={"code": "x", "state": "y"})
    assert r.status_code == 200, r.text
    assert r.json()["mfa_required"] is True
    owner = db.query(User).filter(User.email == "owner@example.com").one()
    from app.database.models import AuthIdentity
    ident = db.query(AuthIdentity).filter(AuthIdentity.provider == "github", AuthIdentity.subject == "137049568").one()
    assert ident.user_id == owner.id
