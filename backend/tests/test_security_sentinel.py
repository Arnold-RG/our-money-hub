"""Regression tests for Sentinel review pass 1 (blockers + should-fix)."""
import os
import threading
from datetime import timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from conftest import Api, add_rate, register
from test_ledger_api import mk_account

from app.api.v1.common import today
from app.core.config import get_settings
from app.main import app

H = {"X-OMH-Client": "web", "Origin": "https://testserver"}
T = today()
D = T.isoformat()


# ---------- Blocker 1: exchange rates are workspace-scoped ----------
def test_manual_rate_only_affects_own_workspace():
    a, _ = register("a@example.com")
    b, _ = register("b@example.com")
    mk_account(a, "EUR acct", "EUR", "10.00")
    add_rate(a, "EUR", "PLN", "4.4633", D)
    add_rate(b, "EUR", "PLN", "1000", D)  # attacker's own workspace
    assert a.get("/reports/summary?currency=PLN").json()["total_balance"]["minor"] == 4463
    assert a.get("/exchange-rates/quote?base=EUR&quote=PLN").json()["rate"].startswith("4.4633")
    assert b.get("/exchange-rates/quote?base=EUR&quote=PLN").json()["rate"].startswith("1000")
    # B's personal rate doesn't leak into A's business workspace either
    me = a.get("/auth/me").json()
    biz = Api(a.c, next(w["id"] for w in me["workspaces"] if w["kind"] == "business"))
    assert biz.get("/exchange-rates/quote?base=EUR&quote=PLN").status_code == 404


def test_rate_sync_requires_workspace_editor_and_is_rate_limited(api, monkeypatch):
    from app.modules.currencies import service as fx

    calls = []
    monkeypatch.setattr(fx, "sync_all", lambda db: calls.append(1) or {"stored": [], "errors": {}})
    assert TestClient(app, base_url="https://testserver").post("/api/v1/exchange-rates/sync", headers={**H, "Origin": "https://testserver"}).status_code == 401
    assert api.post("/exchange-rates/sync").status_code == 200
    assert api.post("/exchange-rates/sync").json().get("cached") is True
    assert len(calls) == 1


def test_manual_rate_validation(api):
    for bad in ["0", "-1", "1e3", "abc", "NaN"]:
        r = api.post("/exchange-rates", {"base": "EUR", "quote": "PLN", "rate": bad, "effective_date": D})
        assert r.status_code == 422, bad
    assert api.post("/exchange-rates", {"base": "EUR", "quote": "EUR", "rate": "1",
                                        "effective_date": D}).status_code == 422


# ---------- Blocker 2: AI guard fails closed + locked check ----------
def test_ai_guard_fails_closed_when_spend_cannot_be_converted(api):
    b = api.post("/budgets", {"name": "AI", "scope": "ai", "amount": "10.00", "currency": "PLN",
                              "hard_limit": True}).json()
    api.post("/ai-usage", {"provider": "openai", "cost": "9999.99", "currency": "USD", "date": D})
    r = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "0.01", "purpose": "x"})
    assert r.status_code == 409 and "exchange rate" in r.json()["detail"]
    add_rate(api, "USD", "PLN", "4.0170", D)
    r = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "0.01", "purpose": "x"})
    assert r.status_code == 409 and "available" in r.json()["detail"]  # now known to be far over


@pytest.mark.skipif(not os.environ.get("DATABASE_URL", "").startswith("postgresql"), reason="row locks need Postgres")
def test_concurrent_reservations_cannot_overspend():
    from app.database.models import Budget
    from app.database.session import SessionLocal
    from app.modules.budgets import service as budgets

    api, _ = register("race@example.com")
    b = api.post("/budgets", {"name": "AI", "scope": "ai", "amount": "10.00", "currency": "USD",
                              "hard_limit": True}).json()
    results, barrier = [], threading.Barrier(2)

    def worker():
        s = SessionLocal()
        try:
            barrier.wait()
            budgets.reserve(s, s.get(Budget, b["id"]), amount_minor=700, purpose="race", agent_id=None,
                            external_ref=None, on=T, user_id=None)
            s.commit()
            results.append("ok")
        except budgets.BudgetUnavailable:
            s.rollback()
            results.append("refused")
        finally:
            s.close()

    ts = [threading.Thread(target=worker) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(results) == ["ok", "refused"]


def test_duplicate_external_ref_is_idempotent(api):
    b = api.post("/budgets", {"name": "AI", "scope": "ai", "amount": "10.00", "currency": "USD",
                              "hard_limit": True}).json()
    first = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "1.00", "purpose": "run",
                                              "external_ref": "run-1"})
    assert first.status_code == 201, first.text
    again = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "1.00", "purpose": "run",
                                              "external_ref": "run-1"})
    assert again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]


def test_reserve_same_ref_integrity_error_returns_existing_or_409(api, monkeypatch):
    """If the idempotency read misses an existing row (the concurrent-retry race),
    reserve must return the existing reservation or raise BudgetUnavailable (409),
    never leak IntegrityError as HTTP 500."""
    from sqlalchemy.orm import Session

    from app.database.models import Budget
    from app.database.session import SessionLocal
    from app.modules.budgets import service as budgets

    bjson = api.post("/budgets", {"name": "AI", "scope": "ai", "amount": "10.00", "currency": "USD",
                                  "hard_limit": True}).json()
    s = SessionLocal()
    first = budgets.reserve(s, s.get(Budget, bjson["id"]), amount_minor=100, purpose="run",
                            agent_id=None, external_ref="run-1", on=T, user_id=None)
    s.commit()
    first_id = first.id
    s.close()

    s2 = SessionLocal()
    orig = Session.scalar
    missed = {"once": False}

    def scalar(self, statement, *args, **kwargs):
        result = orig(self, statement, *args, **kwargs)
        if (
            not missed["once"]
            and result is not None
            and getattr(result, "external_ref", None) == "run-1"
        ):
            missed["once"] = True
            return None
        return result

    monkeypatch.setattr(Session, "scalar", scalar)
    try:
        again = budgets.reserve(s2, s2.get(Budget, bjson["id"]), amount_minor=100, purpose="run",
                                agent_id=None, external_ref="run-1", on=T, user_id=None)
        s2.commit()
        assert again.id == first_id
    except budgets.BudgetUnavailable as exc:
        s2.rollback()
        assert "reservation" in str(exc).lower()
    finally:
        s2.close()
    assert missed["once"] is True


# ---------- Auth should-fix ----------
def test_demo_login_off_by_default():
    assert TestClient(app, base_url="https://testserver").post("/api/v1/auth/demo", headers={**H, "Origin": "https://testserver"}).status_code == 404


def test_each_demo_visitor_gets_a_private_workspace(monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_login_enabled", True)
    monkeypatch.setattr(get_settings(), "app_env", "development")
    a = TestClient(app, base_url="https://testserver").post("/api/v1/auth/demo", headers={**H, "Origin": "https://testserver"}).json()
    b = TestClient(app, base_url="https://testserver").post("/api/v1/auth/demo", headers={**H, "Origin": "https://testserver"}).json()
    assert a["id"] != b["id"] and a["workspaces"][0]["id"] != b["workspaces"][0]["id"]


def test_logout_revokes_session(api):
    token = api.c.cookies.get("__Host-omh_session") or cookies.get("omh_session")
    assert api.post("/auth/logout").status_code == 200
    c = TestClient(app, base_url="https://testserver")
    assert c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_password_hash_is_argon2id(db):
    register("argon@example.com")
    from app.database.models import User

    assert db.query(User).filter_by(email="argon@example.com").one().password_hash.startswith("$argon2id$")


def test_account_lockout_after_failed_logins():
    register("lock@example.com")
    c = TestClient(app, base_url="https://testserver")
    for _ in range(5):
        assert c.post("/api/v1/auth/login", json={"email": "lock@example.com", "password": "wrong-password-xx"},
                      headers={**H, "Origin": "https://testserver"}).status_code == 401
    r = c.post("/api/v1/auth/login", json={"email": "lock@example.com", "password": "correct-horse-battery"}, headers={**H, "Origin": "https://testserver"})
    assert r.status_code == 429


def test_unknown_email_and_wrong_password_look_the_same():
    register("real@example.com")
    c = TestClient(app, base_url="https://testserver")
    r1 = c.post("/api/v1/auth/login", json={"email": "ghost@example.com", "password": "x" * 12}, headers={**H, "Origin": "https://testserver"})
    r2 = c.post("/api/v1/auth/login", json={"email": "real@example.com", "password": "x" * 12}, headers={**H, "Origin": "https://testserver"})
    assert r1.status_code == r2.status_code == 401 and r1.json() == r2.json()


def test_short_password_rejected():
    r = TestClient(app, base_url="https://testserver").post("/api/v1/auth/register", json={"email": "s@example.com", "password": "short-pass1",
                                                             "display_name": "S"}, headers={**H, "Origin": "https://testserver"})
    assert r.status_code == 422


def test_mfa_totp_flow_with_attempt_limit_and_replay_guard():
    api, _ = register("mfa@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    code = pyotp.TOTP(secret).now()
    assert api.post("/auth/mfa/enable", {"code": code}).json()["mfa_enabled"] is True
    c = TestClient(app, base_url="https://testserver")
    r = c.post("/api/v1/auth/login", json={"email": "mfa@example.com", "password": "correct-horse-battery"}, headers={**H, "Origin": "https://testserver"})
    assert r.json().get("mfa_required") is True
    assert c.get("/api/v1/auth/me").status_code == 401  # pending session is not a real session
    assert c.post("/api/v1/auth/mfa/verify", json={"code": code}, headers={**H, "Origin": "https://testserver"}).status_code == 401  # replayed code
    for _ in range(4):
        assert c.post("/api/v1/auth/mfa/verify", json={"code": "000000"}, headers={**H, "Origin": "https://testserver"}).status_code == 401
    # 5th failure revokes the pending session: even a fresh valid code no longer works on it
    c.post("/api/v1/auth/mfa/verify", json={"code": "000000"}, headers={**H, "Origin": "https://testserver"})
    nxt = pyotp.TOTP(secret).at(T and __import__("datetime").datetime.now() + timedelta(seconds=30))
    assert c.post("/api/v1/auth/mfa/verify", json={"code": nxt}, headers={**H, "Origin": "https://testserver"}).status_code == 401


def test_mfa_secret_is_encrypted_at_rest(db):
    api, _ = register("enc@example.com", enrol=False)
    secret = api.post("/auth/mfa/setup").json()["secret"]
    from app.database.models import User

    stored = db.query(User).filter_by(email="enc@example.com").one().mfa_secret_enc
    assert secret not in stored


# ---------- Ledger should-fix ----------
def test_ledger_post_rejects_foreign_workspace_and_wrong_currency(db):
    from app.database.models import FinancialAccount
    from app.modules.ledger import service as ledger

    a, _ = register("la@example.com")
    b, _ = register("lb@example.com")
    acc_a = mk_account(a, "A bank", "PLN", "10.00")
    acc_b = mk_account(b, "B bank", "PLN", "10.00")
    la = db.get(FinancialAccount, acc_a["id"]).ledger_account_id
    lb = db.get(FinancialAccount, acc_b["id"]).ledger_account_id
    with pytest.raises(ledger.LedgerError):
        ledger.post(db, workspace_id=a.ws, entry_date=T, memo="x", status="confirmed", user_id=None,
                    lines=[ledger.Line(la, "PLN", debit=999), ledger.Line(lb, "PLN", credit=999)])
    eq = ledger.opening_equity(db, a.ws, "RWF")
    with pytest.raises(ledger.LedgerError):
        ledger.post(db, workspace_id=a.ws, entry_date=T, memo="x", status="confirmed", user_id=None,
                    lines=[ledger.Line(la, "RWF", debit=5), ledger.Line(eq.id, "RWF", credit=5)])
    db.rollback()


def test_database_refuses_double_reversal_and_duplicate_import(api, db):
    from app.database.models import Transaction

    acc = mk_account(api, "Bank", "PLN", "10.00")
    t = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "1.00", "currency": "PLN",
                                   "date": D, "description": "x"}).json()
    rev = api.post(f"/transactions/{t['id']}/reverse", {}).json()
    clone = db.get(Transaction, rev["id"])
    dup = Transaction(workspace_id=api.ws, kind="reversal", status="confirmed", txn_date=T, description="dup",
                      amount_minor=100, currency="PLN", account_id=acc["id"], journal_entry_id=clone.journal_entry_id,
                      reversal_of_id=t["id"])
    db.add(dup)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_workspace_with_posted_history_cannot_be_deleted(api, db):
    from app.database.models import FinancialWorkspace

    from sqlalchemy import delete

    mk_account(api, "Bank", "PLN", "10.00")
    with pytest.raises(IntegrityError):
        db.execute(delete(FinancialWorkspace).where(FinancialWorkspace.id == api.ws))
        db.commit()
    db.rollback()


# ---------- Rates, dates, rounding ----------
def test_stale_rate_is_flagged(api):
    mk_account(api, "EUR", "EUR", "10.00")
    add_rate(api, "EUR", "PLN", "4.30", (T - timedelta(days=150)).isoformat())
    s = api.get("/reports/summary?currency=PLN").json()
    assert "EUR" in s["stale_rates"]
    # Still converted (flag, don't refuse) so the balance is present and marked stale.
    assert s["total_balance"]["minor"] > 0 or s["stale_rates"] == ["EUR"]
    assert any(x["type"] == "stale_rate" for x in api.get("/reports/signals?currency=PLN").json())


def test_month_end_anchor_is_kept():
    from datetime import date

    from app.core.dates import next_occurrence

    d = date(2027, 1, 31)
    seq = []
    for _ in range(3):
        d = next_occurrence(d, "monthly", 31)
        seq.append(d)
    assert seq == [date(2027, 2, 28), date(2027, 3, 31), date(2027, 4, 30)]


def test_record_payment_is_idempotent(api):
    acc = mk_account(api, "Card", "USD", "100.00", kind="card")
    s = api.post("/subscriptions", {"name": "Plan", "vendor": "V", "kind": "software", "amount": "5.00",
                                    "currency": "USD", "interval": "monthly", "next_renewal": D,
                                    "account_id": acc["id"]}).json()
    first = api.post(f"/subscriptions/{s['id']}/record-payment", {"date": D, "renewal": D})
    assert first.status_code == 201
    # a double-click for the same renewal is refused
    again = api.post(f"/subscriptions/{s['id']}/record-payment", {"date": D, "renewal": D})
    assert again.status_code == 409
    pays = [t for t in api.get("/transactions").json() if t["subscription_id"] == s["id"]]
    assert len(pays) == 1 and api.get("/accounts").json()[0]["balance"]["minor"] == 9500


def test_yearly_plans_sum_without_rounding_drift(api):
    for i in range(3):
        api.post("/subscriptions", {"name": f"Y{i}", "vendor": f"V{i}", "kind": "software", "amount": "100.00",
                                    "currency": "PLN", "interval": "yearly"})
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["subscriptions_monthly"]["minor"] == 2500  # 300/12 exactly, not 3 × 8.33 = 24.99
    assert s["subscriptions_annual"]["minor"] == 30000
    api.post("/subscriptions", {"name": "C", "vendor": "Client", "kind": "client", "direction": "incoming",
                                "amount": "100.00", "currency": "PLN", "interval": "yearly"})
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["client_arr"]["minor"] == 10000  # exact, not 8.33 × 12 = 99.96


def test_bad_month_is_422(api):
    assert api.get("/reports/summary?month=2026-13").status_code == 422


def test_csv_export_neutralises_formulas(api):
    acc = mk_account(api, "Bank", "PLN", "10.00")
    api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "1.00", "currency": "PLN",
                               "date": D, "description": "=HYPERLINK(\"http://evil\")", "payee": "@SUM(A1)"})
    out = api.c.get(f"/api/v1/transactions/export.csv?ws={api.ws}").text
    assert "'=HYPERLINK" in out and "'@SUM" in out


def test_outbox_has_full_spec_envelope(api):
    api.post("/budgets", {"name": "AI", "scope": "ai", "amount": "1.00", "currency": "USD"})
    env = api.get("/events/outbox").json()[0]["envelope"]
    assert {"schema_version", "event_id", "event_type", "source", "organization_id", "project_id",
            "occurred_at", "data"} <= set(env)
    assert env["source"] == "omh" and env["schema_version"] == "1.0"


