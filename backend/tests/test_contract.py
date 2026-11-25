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
    body = json.dumps(FLAT).encode()
    h = signed(body)
    assert svc.post("/api/v1/budget-reservations", content=body,
                    headers={**h, "X-Arnova-Signature": "sha256=" + "0" * 64}).status_code == 401
    assert svc.post("/api/v1/budget-reservations", content=body + b" ", headers=h).status_code == 401  # body tampered
    old = str(int(time.time()) - 301)
    assert post(svc, "/budget-reservations", FLAT, ts=old).status_code == 401  # replay window
    assert post(svc, "/budget-reservations", FLAT, kid="ragi-expired").status_code == 401
    assert post(svc, "/budget-reservations", FLAT, kid="nobody").status_code == 401
    assert post(svc, "/budget-reservations", FLAT, kid="ragi-noscope").status_code == 403
    assert post(svc, "/budget-reservations", FLAT, kid="omh-test", secret=OMH_SECRET).status_code == 403
    # A static bearer is no longer a service credential.
    assert svc.post("/api/v1/budget-reservations", json=FLAT, headers={"Authorization": "Bearer x"}).status_code == 401


def test_reservation_contract(api, svc):
    resp = _validator("budget-reservation-response.schema.json")
    assert post(svc, "/budget-reservations", FLAT).status_code == 409  # no AI budget → denied (fail closed)
    api.post("/budgets", {"name": "Agents", "scope": "ai", "amount": "5.00", "currency": "USD"})
    r = post(svc, "/budget-reservations", FLAT)
    assert r.status_code == 201, r.text
    resp.validate(r.json())
    assert r.json()["status"] == "active" and r.json()["available"]["amount"] == "3.00"
    again = post(svc, "/budget-reservations", FLAT)
    assert again.json()["reservation_id"] == r.json()["reservation_id"]  # idempotent on run_id

    second = post(svc, "/budget-reservations", {**FLAT, "run_id": "run-b", "estimated_cost": {"amount": "1.00", "currency": "USD"}})
    assert second.status_code == 201, second.text
    resp.validate(second.json())
    # The §10 envelope is NOT a second accepted shape: one schema only.
    env = {"schema_version": "1.0", "event_id": "evt-12345678", "event_type": "budget.reservation.requested",
           "source": "ragi", "organization_id": "arnovagroup", "occurred_at": "2026-11-24T22:58:00Z", "data": FLAT}
    assert post(svc, "/budget-reservations", env).status_code == 422
    assert post(svc, "/budget-reservations", {**FLAT, "source": "omh"}).status_code == 403
    assert post(svc, "/budget-reservations", {**FLAT, "unexpected": 1}).status_code == 422
    over = post(svc, "/budget-reservations", {**FLAT, "run_id": "run-2", "estimated_cost": {"amount": "2.01", "currency": "USD"}})
    assert over.status_code == 409  # service calls always hard-limit

    rid = r.json()["reservation_id"]
    st = post(svc, f"/budget-reservations/{rid}/settle", {"actual_cost": {"amount": "1.50", "currency": "USD"}, "provider": "openai"})
    assert st.status_code == 200 and st.json()["budget"]["available"]["minor"] == 250
    assert post(svc, f"/budget-reservations/{rid}/settle", {"actual_cost": {"amount": "1.50", "currency": "USD"}, "provider": "openai"}).status_code == 409
    rel = svc.post(f"/api/v1/budget-reservations/{second.json()['reservation_id']}/release", headers=signed(b""))
    assert rel.status_code == 200 and rel.json()["reservation"]["status"] == "released"


def test_reservation_missing_fx_fails_closed(api, svc):
    api.post("/budgets", {"name": "Agents", "scope": "ai", "amount": "50.00", "currency": "PLN"})
    r = post(svc, "/budget-reservations", {**FLAT, "estimated_cost": {"amount": "2.00", "currency": "RWF"}})
    assert r.status_code == 409


def test_workspace_not_configured(api, svc, monkeypatch):
    monkeypatch.setattr(get_settings(), "omh_ragi_workspace_id", "")
    assert post(svc, "/budget-reservations", FLAT).status_code == 503
    r = svc.get("/api/v1/finance-summary?organization_id=arnovagroup", headers=signed(b""))
    assert r.status_code == 200
    body = r.json()
    _validator("finance-summary.schema.json").validate(body)
    assert body["linked"] is False and body["has_data"] is False and body["by_currency"] == {}


def _usage_event(eid="evt-00000001", usage="u-1", source="ragi"):
    return {"schema_version": "1.0", "event_id": eid, "event_type": "agent.usage.recorded", "source": source,
            "organization_id": "arnovagroup", "project_id": "project-a", "occurred_at": "2026-11-20T12:00:00Z",
            "data": {"agent_id": "agent-a", "provider": "openai", "cost": {"amount": "1.25", "currency": "USD"},
                     "usage_record_id": usage}}


def test_event_inbox(api, svc):
    ev = _usage_event()
    _validator("event.schema.json").validate(ev)
    ok = post(svc, "/events", ev)
    assert ok.status_code == 202 and ok.json()["result"] == "ai_usage_recorded"
    assert post(svc, "/events", ev).json()["status"] == "duplicate"
    # Same usage record under a new event id: acknowledged, not double counted, no 500.
    again = post(svc, "/events", _usage_event("evt-00000002"))
    assert again.status_code == 202 and again.json()["status"] == "duplicate"
    assert [u["cost"]["minor"] for u in api.get("/ai-usage").json()] == [125]
    assert post(svc, "/events", _usage_event("evt-00000003", "u-3", source="omh")).status_code == 403
    assert post(svc, "/events", {**_usage_event("evt-00000004"), "extra": 1}).status_code == 422
    body = json.dumps(_usage_event("evt-00000005")).encode()
    assert svc.post("/api/v1/events", content=body, headers={"X-Arnova-Signature": "sha256=00"}).status_code == 401


def test_finance_summary(api, svc):
    schema = _validator("finance-summary.schema.json")
    get = lambda q: svc.get("/api/v1/finance-summary" + q, headers=signed(b""))  # noqa: E731
    empty = get("?organization_id=arnovagroup")
    assert empty.status_code == 200, empty.text
    schema.validate(empty.json())
    assert empty.json()["has_data"] is False and empty.json()["by_currency"] == {}
    api.post("/accounts", {"name": "Test account", "kind": "bank", "currency": "PLN", "opening_balance": "100.00"})
    api.post("/accounts", {"name": "Test wallet", "kind": "mobile_money", "currency": "RWF", "opening_balance": "5000"})
    full = get("?organization_id=arnovagroup").json()
    schema.validate(full)
    assert full["by_currency"]["PLN"]["balance"]["minor"] == 10000
    assert full["by_currency"]["RWF"]["balance"]["minor"] == 5000  # never added to PLN
    assert get("?organization_id=other").status_code == 404
    assert svc.get("/api/v1/finance-summary?organization_id=arnovagroup").status_code == 401


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
