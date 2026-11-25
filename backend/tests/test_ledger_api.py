from conftest import cat_id, register

from app.modules.ledger.service import Line, LedgerError, validate_lines
import pytest


def mk_account(api, name, cur, opening="0", kind="bank"):
    r = api.post("/accounts", {"name": name, "kind": kind, "currency": cur, "opening_balance": opening,
                               "opening_date": "2026-11-01"})
    assert r.status_code == 201, r.text
    return r.json()


def tb_balanced(api):
    tb = api.get("/ledger/trial-balance").json()
    assert tb["balanced"], tb
    return tb


def test_unbalanced_entry_rejected():
    with pytest.raises(LedgerError):
        validate_lines([Line("a", "PLN", debit=100), Line("b", "PLN", credit=99)])
    with pytest.raises(LedgerError):  # balanced in total, but across currencies
        validate_lines([Line("a", "PLN", debit=100), Line("b", "RWF", credit=100)])


def test_account_opening_income_expense_balances(api):
    acc = mk_account(api, "mBank", "PLN", "1000.00")
    assert acc["balance"]["minor"] == 100000
    r = api.post("/transactions", {"kind": "income", "account_id": acc["id"], "amount": "2500,50", "currency": "PLN",
                                   "date": "2026-11-10", "description": "Invoice paid",
                                   "category_id": cat_id(api, "Client work", "income")})
    assert r.status_code == 201, r.text
    api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "99.99", "currency": "PLN",
                               "date": "2026-11-11", "description": "Groceries",
                               "category_id": cat_id(api, "Food & groceries")})
    accs = api.get("/accounts").json()
    assert accs[0]["balance"] == {"amount": "3400.51", "minor": 340051, "currency": "PLN"}
    tb_balanced(api)


def test_currency_must_match_account(api):
    acc = mk_account(api, "MoMo", "RWF", "0", kind="mobile_money")
    r = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "10", "currency": "PLN",
                                   "date": "2026-11-10", "description": "x"})
    assert r.status_code == 422


def test_rwf_decimals_rejected(api):
    acc = mk_account(api, "MoMo", "RWF", "0", kind="mobile_money")
    r = api.post("/transactions", {"kind": "income", "account_id": acc["id"], "amount": "10.5", "currency": "RWF",
                                   "date": "2026-11-10", "description": "x"})
    assert r.status_code == 422 and "decimal" in r.json()["detail"]


def test_cross_currency_transfer_balances_per_currency(api):
    pln = mk_account(api, "PKO", "PLN", "500.00")
    rwf = mk_account(api, "MTN MoMo", "RWF", "0", kind="mobile_money")
    r = api.post("/transactions", {"kind": "transfer", "account_id": pln["id"], "to_account_id": rwf["id"],
                                   "amount": "100.00", "currency": "PLN", "to_amount": "36800",
                                   "date": "2026-11-12", "description": "Send home"})
    assert r.status_code == 201, r.text
    by = {a["name"]: a for a in api.get("/accounts").json()}
    assert by["PKO"]["balance"]["minor"] == 40000
    assert by["MTN MoMo"]["balance"] == {"amount": "36800", "minor": 36800, "currency": "RWF"}
    tb = tb_balanced(api)
    assert set(tb["currencies"]) == {"PLN", "RWF"}


def test_transfer_needs_received_amount_across_currencies(api):
    pln = mk_account(api, "PKO", "PLN", "500.00")
    rwf = mk_account(api, "MoMo", "RWF", "0", kind="mobile_money")
    r = api.post("/transactions", {"kind": "transfer", "account_id": pln["id"], "to_account_id": rwf["id"],
                                   "amount": "100.00", "currency": "PLN", "date": "2026-11-12", "description": "x"})
    assert r.status_code == 422


def test_reversal_restores_balance_and_cannot_repeat(api):
    acc = mk_account(api, "Cash", "EUR", "50.00", kind="cash")
    t = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "20.00", "currency": "EUR",
                                   "date": "2026-11-12", "description": "Wrong amount"}).json()
    rev = api.post(f"/transactions/{t['id']}/reverse", {"reason": "typo"})
    assert rev.status_code == 201
    assert api.get("/accounts").json()[0]["balance"]["minor"] == 5000
    assert api.post(f"/transactions/{t['id']}/reverse", {}).status_code == 409
    assert api.post(f"/transactions/{rev.json()['id']}/reverse", {}).status_code == 409
    assert api.delete(f"/transactions/{t['id']}").status_code == 405
    # original is still there, marked reversed (history is never overwritten)
    rows = {x["id"]: x for x in api.get("/transactions").json()}
    assert rows[t["id"]]["reversed_by_id"] == rev.json()["id"]
    tb_balanced(api)


def test_pending_not_in_confirmed_balance(api):
    acc = mk_account(api, "Bank", "USD", "10.00")
    api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "3.00", "currency": "USD",
                               "date": "2026-11-12", "description": "Card hold", "status": "pending"})
    a = api.get("/accounts").json()[0]
    assert a["balance"]["minor"] == 1000 and a["pending"]["minor"] == -300


def test_workspace_isolation():
    a, _ = register("a@example.com", "A")
    b, me_b = register("b@example.com", "B")
    acc = mk_account(a, "Secret", "PLN", "1.00")
    # B pointing at A's workspace gets 404, not data
    intruder = type(b)(b.c, a.ws)
    assert intruder.get("/accounts").status_code == 404
    assert intruder.post("/transactions", {"kind": "income", "account_id": acc["id"], "amount": "1", "currency": "PLN",
                                           "date": "2026-11-01", "description": "x"}).status_code == 404
    # B using own workspace cannot use A's account id
    r = b.post("/transactions", {"kind": "income", "account_id": acc["id"], "amount": "1", "currency": "PLN",
                                 "date": "2026-11-01", "description": "x"})
    assert r.status_code == 422


def test_personal_and_business_books_are_separate(api):
    me = api.get("/auth/me").json()
    biz = next(w["id"] for w in me["workspaces"] if w["kind"] == "business")
    mk_account(api, "Personal bank", "PLN", "10.00")
    b = type(api)(api.c, biz)
    assert b.get("/accounts").json() == []


def test_csrf_header_required_for_cookie_writes(api):
    from fastapi.testclient import TestClient
    from app.main import app
    raw = TestClient(app, base_url="https://testserver")
    raw.cookies.update(api.c.cookies)
    r = raw.post("/api/v1/accounts", json={"name": "x", "currency": "PLN"},
                 headers={"X-Workspace-Id": api.ws, "Origin": "https://testserver"})
    assert r.status_code == 403


def test_unauthenticated(api):
    from fastapi.testclient import TestClient
    from app.main import app

    assert TestClient(app, base_url="https://testserver").get("/api/v1/accounts", headers={"X-Workspace-Id": api.ws}).status_code == 401


def test_login_and_wrong_password():
    register("c@example.com")
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app, base_url="https://testserver")
    h = {"X-OMH-Client": "web", "Origin": "https://testserver"}
    assert c.post("/api/v1/auth/login", json={"email": "c@example.com", "password": "nope-nope-nope"}, headers=h).status_code == 401
    assert c.post("/api/v1/auth/login", json={"email": "c@example.com", "password": "correct-horse-battery"},
                  headers=h).status_code == 200


def test_demo_login_is_empty(monkeypatch):
    from fastapi.testclient import TestClient
    from app.core.config import get_settings
    from app.main import app

    monkeypatch.setattr(get_settings(), "demo_login_enabled", True)
    monkeypatch.setattr(get_settings(), "app_env", "development")
    c = TestClient(app, base_url="https://testserver")
    me = c.post("/api/v1/auth/demo", headers={"X-OMH-Client": "web", "Origin": "https://testserver"}).json()
    ws = me["workspaces"][0]["id"]
    assert c.get("/api/v1/accounts", headers={"X-Workspace-Id": ws}).json() == []
    s = c.get("/api/v1/reports/summary", headers={"X-Workspace-Id": ws}).json()
    assert s["has_data"] is False and s["total_balance"] is None
