"""Regenerate MFA recovery codes from a full session."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pyotp
from sqlalchemy import select

from app.core.recovery_codes import consume_code, remaining_count
from app.database.models import AuditLog
from app.database.session import SessionLocal
from tests.conftest import register, _client

PASSWORD = "correct-horse-battery"


def _next_totp(secret: str) -> str:
    # Enrolment already consumed the current 30s window (mfa_last_counter).
    return pyotp.TOTP(secret).at(datetime.now(UTC) + timedelta(seconds=30))


def _enrolled(email: str = "owner@example.com"):
    api, _ = register(email=email, enrol=False)
    setup = api.post("/auth/mfa/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    enabled = api.post("/auth/mfa/enable", {"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200, enabled.text
    codes = enabled.json()["recovery_codes"]
    assert len(codes) == 10
    return api, secret, codes


def test_regenerate_success_returns_ten_new_codes_and_audits():
    api, secret, old = _enrolled()
    me = api.get("/auth/me").json()
    assert me["recovery_codes_remaining"] == 10
    r = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": PASSWORD,
        "code": _next_totp(secret),
    })
    assert r.status_code == 200, r.text
    body = r.json()
    new = body["recovery_codes"]
    assert len(new) == 10
    assert len(set(new)) == 10
    assert set(new).isdisjoint(set(old))
    assert body["recovery_codes_remaining"] == 10
    assert api.get("/auth/me").json()["recovery_codes_remaining"] == 10
    db = SessionLocal()
    try:
        actions = db.scalars(select(AuditLog.action).where(
            AuditLog.action == "user.mfa_recovery_regenerated")).all()
        assert actions == ["user.mfa_recovery_regenerated"]
    finally:
        db.close()


def test_wrong_password_leaves_old_codes():
    api, secret, old = _enrolled()
    r = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": "definitely-not-the-password",
        "code": _next_totp(secret),
    })
    assert r.status_code == 422
    assert "password" in r.json()["detail"].lower()
    assert api.get("/auth/me").json()["recovery_codes_remaining"] == 10
    db = SessionLocal()
    try:
        user_id = api.get("/auth/me").json()["id"]
        assert consume_code(db, user_id, old[0]) is True
        db.commit()
        assert remaining_count(db, user_id) == 9
        assert not db.scalars(select(AuditLog).where(
            AuditLog.action == "user.mfa_recovery_regenerated")).all()
    finally:
        db.close()


def test_wrong_totp_leaves_old_codes():
    api, _secret, old = _enrolled()
    r = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": PASSWORD,
        "code": "000000",
    })
    assert r.status_code == 422
    assert "code" in r.json()["detail"].lower()
    assert api.get("/auth/me").json()["recovery_codes_remaining"] == 10
    db = SessionLocal()
    try:
        user_id = api.get("/auth/me").json()["id"]
        assert consume_code(db, user_id, old[0]) is True
        db.commit()
    finally:
        db.close()


def test_replayed_totp_is_rejected():
    api, secret, _old = _enrolled()
    code = _next_totp(secret)
    first = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": PASSWORD,
        "code": code,
    })
    assert first.status_code == 200, first.text
    second = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": PASSWORD,
        "code": code,
    })
    assert second.status_code == 422
    assert "code" in second.json()["detail"].lower()


def test_old_codes_invalidated_on_success():
    api, secret, old = _enrolled()
    r = api.post("/auth/mfa/recovery-codes/regenerate", {
        "password": PASSWORD,
        "code": _next_totp(secret),
    })
    assert r.status_code == 200, r.text
    new = r.json()["recovery_codes"]
    db = SessionLocal()
    try:
        user_id = api.get("/auth/me").json()["id"]
        for leftover in old:
            assert consume_code(db, user_id, leftover) is False
        assert consume_code(db, user_id, new[0]) is True
        db.commit()
        assert remaining_count(db, user_id) == 9
        assert api.get("/auth/me").json()["recovery_codes_remaining"] == 9
    finally:
        db.close()


def test_unauthenticated_regenerate_is_401():
    r = _client().post("/api/v1/auth/mfa/recovery-codes/regenerate", json={
        "password": PASSWORD,
        "code": "123456",
    })
    assert r.status_code == 401
