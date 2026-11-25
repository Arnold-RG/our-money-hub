"""Keyring JSON, outbox delivery, and RAGI project budgets."""
import json
from datetime import UTC, datetime

import pytest

from app.core.config import get_settings
from app.core.service_auth import load_keyring, signed_headers
from app.database.models import Budget, EventOutbox, FinancialWorkspace
from app.modules.events.delivery import backoff_seconds, pump_once


KEYRING = {"keys": [
    {"kid": "omh-test", "service": "omh", "secret": "o" * 40, "scopes": ["events:write"]},
    {"kid": "ragi-test", "service": "ragi", "secret": "g" * 40, "scopes": ["budget:reserve", "events:write", "finance:read"]},
]}


@pytest.fixture
def keyring(monkeypatch):
    monkeypatch.setattr(get_settings(), "ecosystem_keyring_json", json.dumps(KEYRING))
    monkeypatch.setattr(get_settings(), "ecosystem_keyring_file", "")
    monkeypatch.setattr(get_settings(), "ecosystem_signing_key_id", "omh-test")
    return KEYRING


def test_load_keyring_from_json(keyring):
    keys = load_keyring()
    assert keys["omh-test"].service == "omh"
    headers = signed_headers(b"{}")
    assert headers["X-Arnova-Key-Id"] == "omh-test"


def test_backoff_covers_cold_start():
    assert backoff_seconds(6) == 180


def test_delivery_success_and_retry(db, keyring, monkeypatch):
    monkeypatch.setattr(get_settings(), "ragi_api_url", "https://ragi.example.test")
    ws = FinancialWorkspace(name="Studio", kind="business", base_currency="PLN")
    db.add(ws)
    db.flush()
    ev_ok = EventOutbox(workspace_id=ws.id, event_type="budget.updated",
                        payload={"schema_version": "1.0", "event_id": "omh-1", "event_type": "budget.updated",
                                 "source": "omh", "organization_id": "arnovagroup", "project_id": None,
                                 "occurred_at": datetime.now(UTC).isoformat(), "data": {}})
    ev_fail = EventOutbox(workspace_id=ws.id, event_type="budget.updated",
                          payload={"schema_version": "1.0", "event_id": "omh-2", "event_type": "budget.updated",
                                   "source": "omh", "organization_id": "arnovagroup", "project_id": None,
                                   "occurred_at": datetime.now(UTC).isoformat(), "data": {}})
    db.add_all([ev_ok, ev_fail])
    db.commit()
    calls = {"n": 0}

    class FakeResp:
        def __init__(self, code):
            self.status_code = code

    def fake_post(url, body, headers):
        calls["n"] += 1
        return FakeResp(202 if calls["n"] == 1 else 502)

    monkeypatch.setattr("app.modules.events.delivery._post", fake_post)
    assert pump_once() == 1
    db.refresh(ev_ok)
    db.refresh(ev_fail)
    assert ev_ok.published_at is not None
    assert ev_fail.published_at is None and ev_fail.attempts == 1 and ev_fail.next_attempt_at is not None


def test_ragi_project_budget_preferred(db):
    from app.api.v1.planning import _ai_budget_for
    ws = FinancialWorkspace(name="Studio", kind="business", base_currency="PLN")
    db.add(ws)
    db.flush()
    general = Budget(workspace_id=ws.id, name="All AI", scope="ai", currency="PLN", allocated_minor=10_000_00)
    tagged = Budget(workspace_id=ws.id, name="RAGI project", scope="ai", currency="PLN",
                    allocated_minor=2_000_00, ragi_project_id="2daymovie", ai_provider="openai")
    db.add_all([general, tagged])
    db.flush()
    assert _ai_budget_for(db, ws.id, "openai", "2daymovie").id == tagged.id
    assert _ai_budget_for(db, ws.id, "xai", "2daymovie").id == general.id  # tagged is openai-only; fall back
    assert _ai_budget_for(db, ws.id, "openai", "other-project").id == general.id
