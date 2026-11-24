import hashlib
import hmac
import json

from conftest import add_rate, cat_id
from test_ledger_api import mk_account, tb_balanced

from app.core.dates import month_start
from app.api.v1.common import today

T = today()
D = T.isoformat()
MONTH = T.strftime("%Y-%m")


def spend(api, acc, amount, cur, cat, d=D, desc="spend"):
    r = api.post("/transactions", {"kind": "expense", "account_id": acc["id"], "amount": amount, "currency": cur,
                                   "date": d, "description": desc, "category_id": cat})
    assert r.status_code == 201, r.text
    return r.json()


def test_available_budget_formula(api):
    acc = mk_account(api, "Bank", "PLN", "5000.00")
    food = cat_id(api, "Food & groceries")
    b = api.post("/budgets", {"name": "Food", "category_id": food, "amount": "1000.00", "currency": "PLN"}).json()
    spend(api, acc, "250.10", "PLN", food)
    api.post("/budget-reservations", {"budget_id": b["id"], "amount": "100.00", "purpose": "Party"})
    got = api.get("/budgets").json()[0]
    # Available = Allocated − Actual − Active reservations
    assert got["actual"]["minor"] == 25010 and got["reserved"]["minor"] == 10000
    assert got["available"]["minor"] == 100000 - 25010 - 10000
    assert got["utilization"] == "0.2501"


def test_budget_counts_foreign_spend_converted(api):
    eur = mk_account(api, "Revolut EUR", "EUR", "100.00")
    food = cat_id(api, "Food & groceries")
    add_rate(api, "EUR", "PLN", "4.4633", D)
    api.post("/budgets", {"name": "Food", "category_id": food, "amount": "500.00", "currency": "PLN"})
    spend(api, eur, "10.00", "EUR", food)
    assert api.get("/budgets").json()[0]["actual"]["minor"] == 4463  # 44.633 -> 44.63


def test_reversal_reduces_budget_actual(api):
    acc = mk_account(api, "Bank", "PLN", "500.00")
    food = cat_id(api, "Food & groceries")
    api.post("/budgets", {"name": "Food", "category_id": food, "amount": "100.00", "currency": "PLN"})
    t = spend(api, acc, "40.00", "PLN", food)
    api.post(f"/transactions/{t['id']}/reverse", {})
    assert api.get("/budgets").json()[0]["actual"]["minor"] == 0


def test_budget_exceeded_event_emitted_once(api):
    acc = mk_account(api, "Bank", "PLN", "500.00")
    food = cat_id(api, "Food & groceries")
    api.post("/budgets", {"name": "Food", "category_id": food, "amount": "10.00", "currency": "PLN"})
    spend(api, acc, "11.00", "PLN", food)
    spend(api, acc, "5.00", "PLN", food)
    ev = [e for e in api.get("/events/outbox").json() if e["event_type"] == "budget.exceeded"]
    assert len(ev) == 1
    assert api.get("/budgets").json()[0]["state"] == "exceeded"


def test_ai_spend_guard_hard_limit(api):
    b = api.post("/budgets", {"name": "Agents", "scope": "ai", "amount": "20.00", "currency": "USD",
                              "hard_limit": True}).json()
    r1 = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "15.00", "purpose": "Forge run",
                                           "agent_id": "forge"})
    assert r1.status_code == 201
    r2 = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "6.00", "purpose": "Too much"})
    assert r2.status_code == 409  # stop_when_budget_unavailable
    # Settle: actual charge replaces the estimate
    s = api.post(f"/budget-reservations/{r1.json()['id']}/settle",
                 {"actual_cost": "12.34", "provider": "openai", "model": "gpt", "input_tokens": 1000}).json()
    assert s["budget"]["reserved"]["minor"] == 0 and s["budget"]["actual"]["minor"] == 1234
    assert s["budget"]["available"]["minor"] == 2000 - 1234
    # settling twice is refused
    assert api.post(f"/budget-reservations/{r1.json()['id']}/settle",
                    {"actual_cost": "1", "provider": "openai"}).status_code == 409
    r3 = api.post("/budget-reservations", {"budget_id": b["id"], "amount": "7.66", "purpose": "fits exactly"})
    assert r3.status_code == 201
    rel = api.post(f"/budget-reservations/{r3.json()['id']}/release").json()
    assert rel["budget"]["available"]["minor"] == 766


def test_subscriptions_monthly_duplicates_and_payment(api):
    acc = mk_account(api, "Card", "USD", "100.00", kind="card")
    ai_cat = cat_id(api, "AI & APIs")
    s1 = api.post("/subscriptions", {"name": "ChatGPT Plus", "vendor": "OpenAI", "kind": "ai", "amount": "20.00",
                                     "currency": "USD", "interval": "monthly", "next_renewal": D,
                                     "account_id": acc["id"], "category_id": ai_cat}).json()
    s2 = api.post("/subscriptions", {"name": "ChatGPT (2nd card)", "vendor": "OpenAI Inc.", "kind": "ai",
                                     "amount": "20.00", "currency": "USD", "interval": "monthly"}).json()
    y = api.post("/subscriptions", {"name": "Domain", "vendor": "Registrar", "kind": "domain", "amount": "100.00",
                                    "currency": "USD", "interval": "yearly"}).json()
    assert y["monthly"]["minor"] == 833
    rows = {s["id"]: s for s in api.get("/subscriptions").json()}
    assert rows[s1["id"]]["possible_duplicate"] and rows[s2["id"]]["possible_duplicate"]
    assert not rows[y["id"]]["possible_duplicate"]
    pay = api.post(f"/subscriptions/{s1['id']}/record-payment", {})
    assert pay.status_code == 201, pay.text
    assert pay.json()["subscription"]["next_renewal"] > D
    assert api.get("/accounts").json()[0]["balance"]["minor"] == 8000
    sig = api.get("/reports/signals?currency=USD").json()
    assert any(x["type"] == "duplicate_subscription" for x in sig)
    tb_balanced(api)


def test_summary_reporting_currency_and_missing_rates(api):
    pln = mk_account(api, "PKO", "PLN", "1000.00")
    mk_account(api, "MoMo", "RWF", "100000", kind="mobile_money")
    # Without an RWF rate the RWF balance must NOT be added to the PLN total
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["total_balance"]["minor"] == 100000 and s["unconverted"] == ["RWF"]
    add_rate(api, "RWF", "PLN", "0.002717", "2026-11-18")  # NBP table B 046/B/NBP/2026
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["total_balance"]["minor"] == 100000 + 27170 and s["unconverted"] == []
    # And the same books in RWF (inverse rate)
    s_rwf = api.get("/reports/summary?currency=RWF").json()
    assert s_rwf["total_balance"]["currency"] == "RWF"
    assert s_rwf["total_balance"]["minor"] == 100000 + 368053  # 1000 PLN / 0.002717 = 368053.0...
    api.post("/transactions", {"kind": "income", "account_id": pln["id"], "amount": "300.00", "currency": "PLN",
                               "date": D, "description": "Client", "category_id": cat_id(api, "Client work", "income")})
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["monthly_revenue"]["minor"] == 30000 and s["net_cash_flow"]["minor"] == 30000


def test_cross_rate_via_pln(api):
    mk_account(api, "USD acct", "USD", "10.00")
    add_rate(api, "USD", "PLN", "4.0170", D)
    add_rate(api, "EUR", "PLN", "4.4633", D)
    s = api.get("/reports/summary?currency=EUR").json()
    # 10 USD * 4.0170 / 4.4633 = 9.0000... EUR
    assert s["total_balance"]["minor"] == 900


def test_ai_operating_cost(api):
    acc = mk_account(api, "Card", "USD", "0", kind="card")
    api.post("/subscriptions", {"name": "SuperGrok", "vendor": "xAI", "kind": "ai", "amount": "30.00",
                                "currency": "USD", "interval": "monthly", "account_id": acc["id"]})
    api.post("/ai-usage", {"provider": "openai", "cost": "4.56", "currency": "USD", "date": D, "agent_id": "forge"})
    s = api.get("/reports/summary?currency=USD").json()
    # AI operating cost = subscription allocations + metered API costs
    assert s["ai_operating_cost"]["minor"] == 3000 + 456


def test_client_mrr_arr(api):
    api.post("/subscriptions", {"name": "Care plan", "vendor": "Client A", "kind": "client", "direction": "incoming",
                                "amount": "1200.00", "currency": "PLN", "interval": "yearly"})
    s = api.get("/reports/summary?currency=PLN").json()
    assert s["client_mrr"]["minor"] == 10000 and s["client_arr"]["minor"] == 120000


def test_forecast_includes_renewals(api):
    acc = mk_account(api, "Bank", "PLN", "100.00")
    api.post("/subscriptions", {"name": "Hosting", "vendor": "Render", "kind": "hosting", "amount": "25.00",
                                "currency": "PLN", "interval": "monthly",
                                "next_renewal": (T.replace(day=1) if T.day > 1 else T).isoformat()})
    f = api.get("/reports/forecast?currency=PLN&days=90").json()
    assert f["status"] == "ok" and f["kind"] == "forecast" and f["run_rate_applied"] is False
    assert f["start"]["minor"] == 10000
    assert f["end"]["minor"] == 10000 - 2500 * len(f["events"])


def test_categories_and_50_30_20(api):
    acc = mk_account(api, "Bank", "PLN", "0")
    api.post("/transactions", {"kind": "income", "account_id": acc["id"], "amount": "1000.00", "currency": "PLN",
                               "date": D, "description": "Pay", "category_id": cat_id(api, "Salary", "income")})
    spend(api, acc, "500.00", "PLN", cat_id(api, "Housing & utilities"))
    spend(api, acc, "100.00", "PLN", cat_id(api, "Eating out"))
    c = api.get("/reports/categories?currency=PLN").json()
    assert c["overlay_50_30_20"]["needs"]["share"] == "0.5000"
    assert c["overlay_50_30_20"]["wants"]["share"] == "0.1000"


def test_ike_limit_tracker(api):
    bank = mk_account(api, "Bank", "PLN", "30000.00")
    ike = mk_account(api, "IKE", "PLN", "0", kind="ike")
    api.post("/transactions", {"kind": "transfer", "account_id": bank["id"], "to_account_id": ike["id"],
                               "amount": "1000.00", "currency": "PLN", "date": D, "description": "IKE"})
    lim = api.get("/reports/retirement-limits").json()
    if T.year == 2026:
        assert lim[0]["limit"]["minor"] == 2826000 and lim[0]["remaining"]["minor"] == 2826000 - 100000


def test_csv_import_preview_commit_dedupe_and_export(api):
    mk_account(api, "PKO", "PLN", "0")
    mk_account(api, "MoMo", "RWF", "0", kind="mobile_money")
    csv_text = ("date,description,amount,currency,account,category,payee\n"
                f"{D},Salary,\"5 000,00\",PLN,PKO,Salary,Employer\n"
                f"{D},Lunch,-32.50,PLN,PKO,Eating out,\n"
                f"{D},Airtime,-1500,RWF,MoMo,New category,\n"
                f"{D},Bad,-1.5,RWF,MoMo,,\n"
                f"{D},Ghost,-1,PLN,Nope,,\n")
    files = {"file": ("t.csv", csv_text, "text/csv")}
    p = api.post("/transactions/import/preview", files=files).json()
    assert p["importable"] == 3 and p["errors"] == 2
    c = api.post("/transactions/import/commit", files={"file": ("t.csv", csv_text, "text/csv")}).json()
    assert c["imported"] == 3
    again = api.post("/transactions/import/preview", files={"file": ("t.csv", csv_text, "text/csv")}).json()
    assert again["duplicates"] == 3 and again["importable"] == 0
    by = {a["name"]: a for a in api.get("/accounts").json()}
    assert by["PKO"]["balance"]["minor"] == 500000 - 3250 and by["MoMo"]["balance"]["minor"] == -1500
    out = api.c.get(f"/api/v1/transactions/export.csv?ws={api.ws}").text
    assert "5000.00,PLN,PKO" in out and "1500,RWF,MoMo" in out and "New category" in out
    tb_balanced(api)


def test_event_inbox_signature(api, monkeypatch):
    monkeypatch.setenv("ECOSYSTEM_EVENT_SECRET", "s3cret-for-tests")
    monkeypatch.setenv("OMH_RAGI_WORKSPACE_ID", api.ws)
    ev = {"schema_version": "1.0", "event_id": "evt-1", "event_type": "agent.usage.recorded", "source": "ragi",
          "organization_id": "arnovagroup", "project_id": "omh", "occurred_at": f"{D}T12:00:00Z",
          "data": {"agent_id": "forge", "provider": "openai", "cost": {"amount": "1.25", "currency": "USD"},
                   "usage_record_id": "u-1"}}
    body = json.dumps(ev).encode()
    sig = "sha256=" + hmac.new(b"s3cret-for-tests", body, hashlib.sha256).hexdigest()
    bad = api.c.post("/api/v1/events", content=body, headers={"X-Arnova-Signature": "sha256=00"})
    assert bad.status_code == 401
    ok = api.c.post("/api/v1/events", content=body, headers={"X-Arnova-Signature": sig})
    assert ok.status_code == 202 and ok.json()["result"] == "ai_usage_recorded"
    dup = api.c.post("/api/v1/events", content=body, headers={"X-Arnova-Signature": sig})
    assert dup.json()["status"] == "duplicate"
    assert api.get("/ai-usage").json()[0]["cost"]["minor"] == 125


def test_search_and_audit(api):
    mk_account(api, "Equity Bank", "RWF", "0")
    assert api.get("/search?q=equity").json()[0]["type"] == "account"
    assert any(a["action"] == "account.created" for a in api.get("/audit-logs").json())


def test_nbp_sync_parses_official_shape(db, monkeypatch):
    import httpx

    from app.modules.currencies import service as fx

    def handler(req: httpx.Request):
        u = str(req.url)
        if "nbp" in u:
            code = u.rstrip("/").split("?")[0].rstrip("/").split("/")[-1]
            table = "B" if code == "RWF" else "A"
            mid = {"EUR": 4.4633, "USD": 4.017, "RWF": 0.002717}[code]
            return httpx.Response(200, json={"table": table, "code": code, "rates": [
                {"no": f"x/{table}/NBP/2026", "effectiveDate": "2026-11-24", "mid": mid}]})
        if "bnrrw" in u:
            return httpx.Response(200, json=[{"date": "2026-11-24", "base": "RWF", "quote": "USD", "rate": 0.00068}])
        return httpx.Response(200, json=[{"date": "2026-11-24", "base": "EUR", "quote": "USD", "rate": 1.0963}])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    res = fx.sync_all(db, client)
    db.commit()
    assert not res["errors"] and len(res["stored"]) == 5
    from datetime import date
    q = fx.get_rate(db, "RWF", "PLN", date(2026, 11, 24))
    assert str(q.rate) == "0.002717" and "NBP table B" in q.source
