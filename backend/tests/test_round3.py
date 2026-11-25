"""Round 3: P&L calculator, Polish-business-day FX staleness, future projects."""
from datetime import date, timedelta
from decimal import Decimal

from app.core.holidays import easter_sunday, is_polish_business_day, is_stale_rate, polish_business_days_between
from app.modules.personal_finance.service import calculate, period_bounds
from tests.conftest import add_rate, register


def test_easter_2026():
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert not is_polish_business_day(date(2026, 11, 11))  # Independence Day (Wednesday)
    assert is_polish_business_day(date(2026, 11, 10))


def test_weekend_is_not_two_business_days():
    friday = date(2026, 11, 20)
    monday = date(2026, 11, 23)
    assert polish_business_days_between(friday, monday) == 1
    assert not is_stale_rate(friday, monday)
    wednesday = date(2026, 11, 25)
    assert polish_business_days_between(friday, wednesday) == 3
    assert is_stale_rate(friday, wednesday)


def test_independence_day_is_skipped():
    # Tue 10 Nov 2026 → Thu 12 Nov 2026 skips Wed 11 (holiday) so 1 business day
    assert polish_business_days_between(date(2026, 11, 10), date(2026, 11, 12)) == 1
    assert not is_stale_rate(date(2026, 11, 10), date(2026, 11, 12))


def test_pnl_formula_half_up_once_and_dash_when_income_zero(api, db):
    # I=6200, L=3410, U=980, S=1000 → N=1810, 29.2%, 16.1% (matches the v3 board figures)
    period = "2026-11"
    start, end = period_bounds(period)
    rows = [
        ("income", "Salary", "5200.00"),
        ("income", "Side projects", "1000.00"),
        ("living", "Rent", "2100.00"),
        ("living", "Groceries", "820.00"),
        ("living", "Utilities", "310.00"),
        ("living", "Transport", "180.00"),
        ("usage", "Subscriptions", "140.00"),
        ("usage", "Phone and internet", "120.00"),
        ("usage", "Leisure", "720.00"),
        ("savings", "Emergency fund", "700.00"),
        ("savings", "Future projects", "300.00"),
    ]
    for cat, label, amount in rows:
        r = api.post("/my-finances/entries", {"category": cat, "label": label, "amount": amount,
                                               "currency": "PLN", "occurred_on": "2026-11-10"})
        assert r.status_code == 201, r.text
    out = api.get("/my-finances?period=2026-11").json()
    assert out["empty"] is False
    assert out["income"]["amount"] == "6200.00"
    assert out["living"]["amount"] == "3410.00"
    assert out["usage"]["amount"] == "980.00"
    assert out["savings"]["amount"] == "1000.00"
    assert out["net"]["amount"] == "1810.00"
    assert out["pnl_pct"] == "29.2"
    assert out["savings_rate_pct"] == "16.1"

    # Zero income: net is a loss, percentages are null (UI shows —)
    api2, _ = register("zeroinc@example.com", "Zero")
    api2.post("/my-finances/entries", {"category": "living", "label": "Rent", "amount": "100.00",
                                       "currency": "PLN", "occurred_on": "2026-11-10"})
    z = api2.get("/my-finances?period=2026-11").json()
    assert z["income"]["minor"] == 0
    assert z["net"]["amount"] == "-100.00"
    assert z["pnl_pct"] is None and z["savings_rate_pct"] is None

    empty = register("emptyfin@example.com", "Empty")[0].get("/my-finances?period=2026-11").json()
    assert empty["empty"] is True
    assert empty["net"]["minor"] == 0


def test_future_project_budget_defaults_to_pln(api):
    r = api.post("/future-projects", {"name": "New bike", "planned": "3600.00", "funded": "400.00",
                                      "target_date": "2027-05-31"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["currency"] == "PLN"
    assert body["planned"]["amount"] == "3600.00"
    assert body["funded"]["amount"] == "400.00"
    assert body["gap"]["amount"] == "3200.00"


def test_fx_quote_flags_stale_after_two_polish_business_days(api):
    add_rate(api, "EUR", "PLN", "4.2320", "2026-11-20")  # Friday
    fresh = api.get("/exchange-rates/quote?base=EUR&quote=PLN&on=2026-11-23").json()  # Monday
    assert fresh["stale"] is False
    stale = api.get("/exchange-rates/quote?base=EUR&quote=PLN&on=2026-11-25").json()  # Wednesday
    assert stale["stale"] is True
    assert stale["effective_date"] == "2026-11-20"
    assert stale["source"]


GENERIC_INVITE = "This invite can’t be used. Ask the owner for a new one."


def test_omh_invite_accept_and_generic_errors():
    from app.core.config import get_settings
    from tests.conftest import _client

    owner_api, me = register("invite-owner@example.com", "Invite Owner")
    s = get_settings()
    prev = s.registration_mode
    s.registration_mode = "invite"
    try:
        ws = next(w["id"] for w in me["workspaces"] if w["kind"] == "personal")
        created = owner_api.post("/auth/invites", {"email": "new-member@example.com", "role": "editor", "workspace_id": ws})
        assert created.status_code == 200, created.text
        raw = created.json()["token"]
        assert "/invite#" in created.json()["invite_url"]

        c = _client()
        bad = c.post("/api/v1/auth/invite/preview", json={"token": "not-a-real-token"})
        assert bad.status_code == 403
        assert bad.json()["detail"] == GENERIC_INVITE

        preview = c.post("/api/v1/auth/invite/preview", json={"token": raw})
        assert preview.status_code == 200, preview.text
        assert preview.json()["email"] == "new-member@example.com"
        assert c.cookies.get("__Host-omh_invite")

        mismatch = c.post("/api/v1/auth/register", json={
            "email": "other@example.com", "password": "correct-horse-battery",
            "display_name": "Other", "invite_token": raw,
        })
        assert mismatch.status_code == 403
        assert mismatch.json()["detail"] == GENERIC_INVITE

        ok = c.post("/api/v1/auth/register", json={
            "email": "new-member@example.com", "password": "correct-horse-battery",
            "display_name": "New Member", "invite_token": raw,
        })
        assert ok.status_code == 200, ok.text
        me2 = c.get("/api/v1/auth/me")
        assert me2.status_code == 200, me2.text
        roles = {w["id"]: w["role"] for w in me2.json()["workspaces"]}
        assert roles.get(ws) == "editor"
        # invite grants only that workspace
        assert list(roles) == [ws]

        reuse = _client().post("/api/v1/auth/register", json={
            "email": "new-member@example.com", "password": "correct-horse-battery",
            "display_name": "New Member", "invite_token": raw,
        })
        assert reuse.status_code == 403
        assert reuse.json()["detail"] == GENERIC_INVITE
    finally:
        s.registration_mode = prev



def test_refunds_reduce_original_category_on_cash_basis(api):
    """A living refund in the same period reduces living; a later-month refund counts then."""
    api.post("/my-finances/entries", {"category": "living", "label": "Jacket", "amount": "200.00",
                                      "currency": "PLN", "occurred_on": "2026-11-10"})
    r = api.post("/my-finances/entries", {"category": "living", "label": "Jacket returned", "amount": "200.00",
                                          "currency": "PLN", "occurred_on": "2026-11-20", "is_refund": True})
    assert r.status_code == 201, r.text
    assert r.json()["is_refund"] is True
    nov = api.get("/my-finances?period=2026-11").json()
    assert nov["living"]["amount"] == "0.00"

    api.post("/my-finances/entries", {"category": "living", "label": "Train tickets", "amount": "80.00",
                                      "currency": "PLN", "occurred_on": "2026-11-15"})
    api.post("/my-finances/entries", {"category": "living", "label": "Ticket refund", "amount": "80.00",
                                      "currency": "PLN", "occurred_on": "2026-12-02", "is_refund": True})
    nov = api.get("/my-finances?period=2026-11").json()
    dec = api.get("/my-finances?period=2026-12").json()
    assert nov["living"]["amount"] == "80.00"
    assert dec["living"]["amount"] == "-80.00"


def test_pnl_sum_exact_then_half_up_once_across_fx(api):
    """Two EUR lines at a published 4.005 mid sum to 8.01 PLN, not 8.02 (per-line) or 8.00."""
    add_rate(api, "EUR", "PLN", "4.005", "2026-11-01")
    api.post("/my-finances/entries", {"category": "income", "label": "Fee A", "amount": "1.00",
                                      "currency": "EUR", "occurred_on": "2026-11-10"})
    api.post("/my-finances/entries", {"category": "income", "label": "Fee B", "amount": "1.00",
                                      "currency": "EUR", "occurred_on": "2026-11-11"})
    out = api.get("/my-finances?period=2026-11").json()
    assert out["income"]["amount"] == "8.01"
    assert out["income"]["currency"] == "PLN"


def test_ledger_refund_reduces_original_expense_category(api):
    from tests.conftest import cat_id

    acc = api.post("/accounts", {"name": "mBank", "kind": "bank", "currency": "PLN",
                                 "opening_balance": "1000.00", "opening_date": "2026-11-01"}).json()
    cat = cat_id(api, "Food & groceries")
    spent = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "120.00",
                                       "currency": "PLN", "date": "2026-11-05", "description": "Groceries",
                                       "category_id": cat})
    assert spent.status_code == 201, spent.text
    refund = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": "40.00",
                                        "currency": "PLN", "date": "2026-11-20", "description": "Returned milk",
                                        "category_id": cat, "is_refund": True, "refund_of_id": spent.json()["id"]})
    assert refund.status_code == 201, refund.text
    assert refund.json()["is_refund"] is True
    cats = api.get("/reports/categories?month=2026-11&currency=PLN").json()
    row = next(r for r in cats["categories"] if r["category_id"] == cat)
    assert row["amount"]["amount"] == "80.00"
    # cash came back: 1000 - 120 + 40
    bal = next(a for a in api.get("/accounts").json() if a["id"] == acc["id"])
    assert bal["balance"]["amount"] == "920.00"
