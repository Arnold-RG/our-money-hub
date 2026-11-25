"""Owner trusted-device cookie: TOTP-only unlock, lockout, and revocation."""
from datetime import UTC, datetime, timedelta

import pyotp
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import register
from tests.test_security_sentinel import H


def next_totp(secret: str) -> str:
    return pyotp.TOTP(secret).at(datetime.now(UTC) + timedelta(seconds=30))


def _full_login(email: str, password: str, secret: str) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    r = c.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json().get("mfa_required") is True
    r = c.post("/api/v1/auth/mfa/verify", json={"code": next_totp(secret)}, headers=H)
    assert r.status_code == 200, r.text
    return c


def test_full_login_sets_trusted_device_cookie():
    api, me = register("trust@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    assert api.post("/auth/mfa/enable", {"code": pyotp.TOTP(secret).now()}).json()["mfa_enabled"] is True
    # enable already issues a trusted cookie on the register client
    c = _full_login("trust@example.com", "correct-horse-battery", secret)
    assert c.cookies.get("__Host-omh_trusted")
    items = c.get("/api/v1/auth/trusted-devices", headers=H).json()["items"]
    assert items
    assert any(i["current"] for i in items)


def test_unlock_with_totp_after_session_dropped():
    api, _ = register("unlock@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    assert api.post("/auth/mfa/enable", {"code": pyotp.TOTP(secret).now()}).json()["mfa_enabled"] is True
    trusted = api.c.cookies.get("__Host-omh_trusted")
    assert trusted
    bare = TestClient(app, base_url="https://testserver")
    bare.cookies.set("__Host-omh_trusted", trusted)
    hint = bare.get("/api/v1/auth/trusted-device", headers=H).json()
    assert hint["available"] is True
    assert hint["display_name"]
    assert bare.get("/api/v1/auth/me", headers=H).status_code == 401
    r = bare.post("/api/v1/auth/unlock", json={"code": next_totp(secret)}, headers=H)
    assert r.status_code == 200, r.text
    assert bare.get("/api/v1/auth/me", headers=H).status_code == 200


def test_unlock_rejects_bad_codes_and_locks():
    api, _ = register("lock@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    assert api.post("/auth/mfa/enable", {"code": pyotp.TOTP(secret).now()}).json()["mfa_enabled"] is True
    trusted = api.c.cookies.get("__Host-omh_trusted")
    bare = TestClient(app, base_url="https://testserver")
    bare.cookies.set("__Host-omh_trusted", trusted)
    statuses = [bare.post("/api/v1/auth/unlock", json={"code": "000000"}, headers=H).status_code for _ in range(5)]
    assert statuses[:4] == [401, 401, 401, 401]
    assert statuses[4] == 429
    r = bare.post("/api/v1/auth/unlock", json={"code": next_totp(secret)}, headers=H)
    assert r.status_code == 429


def test_unlock_without_cookie_requires_password():
    c = TestClient(app, base_url="https://testserver")
    assert c.get("/api/v1/auth/trusted-device", headers=H).json() == {"available": False}
    assert c.post("/api/v1/auth/unlock", json={"code": "123456"}, headers=H).status_code == 401


def test_revoke_trusted_device():
    api, _ = register("revoke@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    assert api.post("/auth/mfa/enable", {"code": pyotp.TOTP(secret).now()}).json()["mfa_enabled"] is True
    trusted = api.c.cookies.get("__Host-omh_trusted")
    items = api.get("/auth/trusted-devices").json()["items"]
    device_id = items[0]["id"]
    assert api.c.delete(f"/api/v1/auth/trusted-devices/{device_id}", headers=H).status_code == 204
    assert api.get("/auth/trusted-devices").json()["items"] == []
    bare = TestClient(app, base_url="https://testserver")
    bare.cookies.set("__Host-omh_trusted", trusted)
    assert bare.get("/api/v1/auth/trusted-device", headers=H).json()["available"] is False
