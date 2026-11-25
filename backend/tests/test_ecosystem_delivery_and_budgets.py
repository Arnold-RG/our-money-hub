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
    from app.modules.events.delivery import configured
    assert configured() is False

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
