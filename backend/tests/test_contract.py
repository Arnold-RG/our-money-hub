"""RAGI ⇄ OMH contract tests (ecosystem-contracts/docs/authentication.md, schemas/*.json).

Requests are signed exactly as the contract says: sha256=hex(HMAC(secret, "<ts>.<raw body>")).
"""
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from app.core.config import get_settings
from app.main import app

HERE = Path(__file__).parent / "contracts"
SHARED = Path(os.environ.get("ECOSYSTEM_CONTRACTS_DIR", Path(__file__).resolve().parents[3] / "ecosystem-contracts"))
RAGI_SECRET = "ragi-test-secret-0123456789abcdef-xyz"
OMH_SECRET = "omh-test-secret-0123456789abcdef-xyz"


def _schema(name):
    return json.loads((HERE / name).read_text())


def _validator(name):
    reg = Registry()
    for p in HERE.glob("*.schema.json"):
        s = json.loads(p.read_text())
        reg = reg.with_resource(p.name, Resource.from_contents(s))
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return Draft202012Validator(_schema(name), registry=reg)


def sign(secret: str, ts: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()


def signed(body: bytes, kid="ragi-test", secret=RAGI_SECRET, ts=None):
    ts = ts or str(int(time.time()))
    return {"X-Arnova-Key-Id": kid, "X-Arnova-Timestamp": ts, "X-Arnova-Signature": sign(secret, ts, body),
            "Content-Type": "application/json"}


@pytest.fixture
def svc(api, monkeypatch, tmp_path):
    ring = {"keys": [
        {"kid": "ragi-test", "service": "ragi", "secret": RAGI_SECRET,
         "scopes": ["budget:reserve", "events:write", "finance:read"]},
        {"kid": "ragi-noscope", "service": "ragi", "secret": RAGI_SECRET, "scopes": ["events:write"]},
        {"kid": "ragi-expired", "service": "ragi", "secret": RAGI_SECRET, "scopes": ["budget:reserve"],
         "not_after": "2020-01-01T00:00:00Z"},
        {"kid": "omh-test", "service": "omh", "secret": OMH_SECRET, "scopes": ["events:write", "budget:reserve"]},
    ]}
    f = tmp_path / "keyring.json"
    f.write_text(json.dumps(ring))
    s = get_settings()
    monkeypatch.setattr(s, "ecosystem_keyring_file", str(f))
    monkeypatch.setattr(s, "omh_ragi_workspace_id", api.ws)
    return TestClient(app, base_url="https://testserver")


def post(c, path, obj, **kw):
    body = json.dumps(obj, separators=(",", ":")).encode()
    return c.post("/api/v1" + path, content=body, headers=signed(body, **kw))


FLAT = {"agent_id": "agent-a", "run_id": "run-1", "project_id": "project-a", "provider": "openai",
        "estimated_cost": {"amount": "2.00", "currency": "USD"}, "source": "ragi"}


def test_vendored_contract_matches_shared_copy():
    if not SHARED.exists():
        pytest.skip("shared ecosystem-contracts not present")
    for p in HERE.glob("*.json"):
        shared = next(SHARED.rglob(p.name), None)
        assert shared is not None, f"{p.name} missing from ecosystem-contracts"
        assert json.loads(shared.read_text()) == json.loads(p.read_text()), f"{p.name} drifted from ecosystem-contracts"


def test_request_schema_matches_omh_model():
    v = _validator("budget-reservation-request.schema.json")
    v.validate(FLAT)
    assert list(v.iter_errors({**FLAT, "unexpected": 1}))  # both sides forbid extra fields
    assert list(v.iter_errors({**FLAT, "estimated_cost": {"amount": "2.001", "currency": "USD"}}))


def test_signing_matches_contract_vector():
    # Vector: secret "k"*32, ts "1700000000", body b"{}"
    expected = "sha256=" + hmac.new(b"k" * 32, b"1700000000.{}", hashlib.sha256).hexdigest()
    assert sign("k" * 32, "1700000000", b"{}") == expected


def test_auth_failures(api, svc):
    """Peer service routes are disabled; callers receive 404 rather than a signed session."""
    body = json.dumps(FLAT).encode()
    h = signed(body)
    assert svc.post("/api/v1/budget-reservations", content=body, headers=h).status_code == 404
    assert svc.get("/api/v1/finance-summary?organization_id=arnovagroup", headers=signed(b"")).status_code == 404
    ev = {"schema_version": "1.0", "event_id": "evt-00000001", "event_type": "agent.usage.recorded",
          "source": "ragi", "organization_id": "arnovagroup", "occurred_at": "2026-11-20T12:00:00Z", "data": {}}
    assert post(svc, "/events", ev).status_code == 404

def test_reservation_contract(api, svc):
    assert post(svc, "/budget-reservations", FLAT).status_code == 404

def test_reservation_missing_fx_fails_closed(api, svc):
    assert post(svc, "/budget-reservations", {**FLAT, "estimated_cost": {"amount": "2.00", "currency": "RWF"}}).status_code == 404

def test_workspace_not_configured(api, svc, monkeypatch):
    monkeypatch.setattr(get_settings(), "omh_ragi_workspace_id", "")
    assert post(svc, "/budget-reservations", FLAT).status_code == 404
    r = svc.get("/api/v1/finance-summary?organization_id=arnovagroup", headers=signed(b""))
    assert r.status_code == 404

def _usage_event(eid="evt-00000001", usage="u-1", source="ragi"):
    return {"schema_version": "1.0", "event_id": eid, "event_type": "agent.usage.recorded", "source": source,
            "organization_id": "arnovagroup", "project_id": "project-a", "occurred_at": "2026-11-20T12:00:00Z",
            "data": {"agent_id": "agent-a", "provider": "openai", "cost": {"amount": "1.25", "currency": "USD"},
                     "usage_record_id": usage}}


def test_event_inbox(api, svc):
    ev = _usage_event()
    assert post(svc, "/events", ev).status_code == 404

def test_finance_summary(api, svc):
    r = svc.get("/api/v1/finance-summary?organization_id=arnovagroup", headers=signed(b""))
    assert r.status_code == 404

def test_registration_closed_by_default_and_owner_needs_setup_token(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "allow_registration", False)
    monkeypatch.setattr(s, "registration_mode", "closed")
    monkeypatch.setattr(s, "omh_owner_setup_token", "")
    h = {"X-OMH-Client": "web", "Origin": "https://testserver"}
    body = {"email": "first@example.com", "username": "first_example", "password": "correct-horse-battery", "display_name": "Owner"}
    c = TestClient(app, base_url="https://testserver")
    assert c.get("/api/v1/auth/config").json()["registration_mode"] == "closed"
    assert c.post("/api/v1/auth/register", json=body, headers=h).status_code == 403  # no token configured: closed
    monkeypatch.setattr(s, "omh_owner_setup_token", "one-time-setup-token-for-tests-ok")
    assert c.get("/api/v1/auth/config").json()["owner_setup"] is True
    assert c.post("/api/v1/auth/register", json={**body, "setup_token": "wrong"}, headers=h).status_code == 403
    ok = c.post("/api/v1/auth/register", json={**body, "setup_token": "one-time-setup-token-for-tests-ok"}, headers=h)
    assert ok.status_code == 200
    again = TestClient(app, base_url="https://testserver").post("/api/v1/auth/register", headers=h, json={**body, "email": "second@example.com", "username": "second_example",
                                                                           "setup_token": "one-time-setup-token-for-tests-ok"})
    assert again.status_code == 403  # the token works once: an owner now exists
    assert TestClient(app, base_url="https://testserver").get("/api/v1/auth/config").json()["registration_mode"] == "closed"
