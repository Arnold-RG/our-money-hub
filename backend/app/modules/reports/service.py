"""Financial headquarters reports. Every figure is in one explicitly selected reporting currency.

Amounts that cannot be converted (no rate on file) are never added; they're listed in ``unconverted``.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dates import add_months, month_end, month_start
from app.core.money import Money, format_plain, round_report
from app.database.models import (AIUsageRecord, Budget, FinancialAccount, SavingsGoal, Subscription, Transaction,
                                 TransactionCategory)
from app.modules.budgets import service as budgets
from app.modules.currencies.service import Converter
from app.modules.reports.flows import compute_flows
from app.modules.subscriptions import service as subs
from app.modules.transactions.service import account_balances

# Official 2026 annual contribution limits (Monitor Polski 2025 items 1202 and 1156; gov.pl).
RETIREMENT_LIMITS_2026 = {
    "ike": {"limit_minor": 2_826_000, "currency": "PLN", "label": "IKE 2026 limit",
            "source": "https://www.gov.pl/web/rodzina/ike-limit-wplat"},
    "ikze": {"limit_minor": 1_130_400, "currency": "PLN", "label": "IKZE 2026 limit (16,956 zł if self-employed)",
             "source": "https://www.gov.pl/web/rodzina/ikze-limit-wplat"},
}


def m(minor: int | None, currency: str) -> dict | None:
    """Money on the wire: decimal string + integer minor units, never a float."""
    if minor is None:
        return None
    return {"amount": format_plain(minor, currency), "minor": minor, "currency": currency}


def _accounts(db: Session, ws: str) -> list[FinancialAccount]:
    return list(db.scalars(select(FinancialAccount).where(FinancialAccount.workspace_id == ws,
                                                          FinancialAccount.archived.is_(False))))


def balances(db: Session, ws: str, conv: Converter, on: date) -> tuple[int, int, list[dict]]:
    total_e, pending_e, rows = Decimal(0), Decimal(0), []
    for a in _accounts(db, ws):
        b = account_balances(db, a)
        c_e = conv.exact(Money(b["confirmed"], a.currency), on)
        p_e = conv.exact(Money(b["pending"], a.currency), on)
        if c_e is not None:
            total_e += c_e
        if p_e is not None:
            pending_e += p_e
        c_minor = round_report(c_e, conv.to) if c_e is not None else None
        rows.append({"account_id": a.id, "name": a.name, "kind": a.kind, "currency": a.currency,
                     "balance": m(b["confirmed"], a.currency), "pending": m(b["pending"], a.currency),
                     "converted": m(c_minor, conv.to) if c_minor is not None else None})
    return round_report(total_e, conv.to), round_report(pending_e, conv.to), rows


def subscription_totals(db: Session, ws: str, conv: Converter, on: date) -> dict:
    """Monthly totals summed from EXACT annualised amounts and rounded once per total (no 8.33×12 drift).

    Each plan's annual amount (exact, e.g. 20 × 12 or 100 × 1) is converted, summed, then ÷12 and rounded once.
    ARR is the exact annual sum (rounded once), not MRR×12.
    """
    annual = defaultdict(Decimal)
    for s in db.scalars(select(Subscription).where(Subscription.workspace_id == ws)):
        if not subs.is_live(s):
            continue
        yearly = Money(s.amount_minor, s.currency).multiply(subs.PER_YEAR[s.interval])  # exact: integer multiples
        if s.interval == "weekly":
            yearly = Money(s.amount_minor * 52, s.currency)
        yearly_e = conv.exact(yearly, on)
        if yearly_e is None:
            continue
        keys = ["mrr"] if s.direction == "incoming" else ["outgoing"] + (["ai"] if s.kind in subs.AI_KINDS else []) + (
            ["infra"] if s.kind in subs.INFRA_KINDS else [])
        for k in keys:
            annual[k] += yearly_e
    out = defaultdict(int)
    for k, v in annual.items():
        out[k] = round_report(v / 12, conv.to)
        out[k + "_annual"] = round_report(v, conv.to)
    return out


def ai_usage_total(db: Session, ws: str, start: date, end: date, conv: Converter) -> int:
    total = Decimal(0)
    for u in db.scalars(select(AIUsageRecord).where(AIUsageRecord.workspace_id == ws,
                                                    AIUsageRecord.occurred_on >= start, AIUsageRecord.occurred_on <= end)):
        c = conv.exact(Money(u.cost_minor, u.currency), u.occurred_on)
        if c is not None:
            total += c
    return round_report(total, conv.to)


def summary(db: Session, ws: str, currency: str, month: date, today: date) -> dict:
    conv = Converter(db, currency, ws)
    start, end = month_start(month), month_end(month)
    total, pending, acc_rows = balances(db, ws, conv, today)
    f = compute_flows(db, ws, start, end, conv)
    st = subscription_totals(db, ws, conv, today)
    usage = ai_usage_total(db, ws, start, end, conv)
    available = 0
    budget_rows = []
    for b in db.scalars(select(Budget).where(Budget.workspace_id == ws)):
        bs = budgets.status(db, b, month)
        a = conv(Money(bs.available_minor, b.currency), today)
        if a is not None:
            available += a.minor
        budget_rows.append(budget_view(bs))
    goals = []
    accounts_by_id = {a.id: a for a in _accounts(db, ws)}
    for g in db.scalars(select(SavingsGoal).where(SavingsGoal.workspace_id == ws)):
        saved = None
        if g.account_id and g.account_id in accounts_by_id:
            acc = accounts_by_id[g.account_id]
            bal = account_balances(db, acc)["confirmed"]
            mc = Converter(db, g.currency, ws)(Money(bal, acc.currency), today)
            saved = mc.minor if mc else None
        goals.append({"id": g.id, "name": g.name, "target": m(g.target_minor, g.currency), "saved": m(saved, g.currency),
                      "progress": str((Decimal(saved) / Decimal(g.target_minor)).quantize(Decimal("0.0001")))
                      if saved is not None else None,
                      "target_date": g.target_date.isoformat() if g.target_date else None})
    has_data = bool(acc_rows) or f.income or f.expense
    return {
        "currency": currency, "month": start.strftime("%Y-%m"), "has_data": bool(has_data),
        "total_balance": m(total, currency) if acc_rows else None,
        "pending_balance": m(pending, currency) if acc_rows else None,
        "monthly_revenue": m(f.income, currency), "monthly_expenses": m(f.expense, currency),
        "net_cash_flow": m(f.net, currency),
        "subscriptions_monthly": m(st["outgoing"], currency),
        "ai_subscriptions_monthly": m(st["ai"], currency),
        "ai_usage_month": m(usage, currency),
        "ai_operating_cost": m(st["ai"] + usage, currency),
        "infrastructure_monthly": m(st["infra"], currency),
        "client_mrr": m(st["mrr"], currency), "client_arr": m(st["mrr_annual"], currency),
        "subscriptions_annual": m(st["outgoing_annual"], currency),
        "available_budget": m(available, currency) if budget_rows else None,
        "accounts": acc_rows, "budgets": budget_rows, "goals": goals,
        "unconverted": sorted(conv.missing | set(f.unconverted)),
        "stale_rates": sorted(conv.stale),
        "rates_used": {k: {"rate": str(v.rate), "effective_date": v.effective_date.isoformat() if v.effective_date else None,
                           "source": v.source} for k, v in conv.used.items()},
    }


def budget_view(bs: budgets.BudgetStatus) -> dict:
    b = bs.budget
    over = bs.actual_minor > b.allocated_minor
    return {"id": b.id, "name": b.name, "scope": b.scope, "category_id": b.category_id, "ai_provider": b.ai_provider,
            "currency": b.currency,
            "allocated": m(b.allocated_minor, b.currency),
            "actual_spend": m(bs.actual_minor, b.currency),
            "actual": m(bs.actual_minor, b.currency),  # backward compatible alias
            "reserved": m(bs.reserved_minor, b.currency),
            "available": m(bs.available_minor, b.currency),
            "utilization": str(bs.utilization),
            "committed_utilization": str(bs.committed_utilization),
            "state": bs.state,
            "over_budget": over,
            "alert_threshold_pct": b.alert_threshold_pct, "hard_limit": b.hard_limit,
            "period": bs.period_start.strftime("%Y-%m"), "unconverted": bs.unconverted}


def cashflow(db: Session, ws: str, currency: str, months: int, today: date) -> dict:
    conv = Converter(db, currency, ws)
    first = month_start(add_months(today, -(months - 1)))
    f = compute_flows(db, ws, first, month_end(today), conv)
    series = []
    for i in range(months):
        k = add_months(first, i).strftime("%Y-%m")
        inc, exp = f.by_month.get(k, [0, 0])
        series.append({"month": k, "income": m(inc, currency), "expense": m(exp, currency), "net": m(inc - exp, currency)})
    return {"currency": currency, "series": series, "unconverted": sorted(f.unconverted)}


def categories(db: Session, ws: str, currency: str, month: date) -> dict:
    conv = Converter(db, currency, ws)
    f = compute_flows(db, ws, month_start(month), month_end(month), conv)
    cats = {c.id: c for c in db.scalars(select(TransactionCategory).where(TransactionCategory.workspace_id == ws))}
    rows = sorted(({"category_id": cid, "name": cats[cid].name if cid in cats else "Unknown",
                    "bucket": cats[cid].bucket if cid in cats else None, "amount": m(v, currency)}
                   for cid, v in f.by_category.items() if v), key=lambda r: -r["amount"]["minor"])
    # Optional 50/30/20 overlay (Warren & Tyagi, "All Your Worth", 2005) on net income: a guide, not a rule.
    buckets = defaultdict(int)
    for cid, v in f.by_category.items():
        buckets[(cats[cid].bucket if cid in cats else None) or "unassigned"] += v
    overlay = None
    if f.income > 0:
        overlay = {k: {"actual": m(buckets.get(k, 0), currency),
                       "share": str((Decimal(buckets.get(k, 0)) / Decimal(f.income)).quantize(Decimal("0.0001"))),
                       "guide": g}
                   for k, g in (("needs", "0.50"), ("wants", "0.30"), ("savings", "0.20"))}
    return {"currency": currency, "month": month.strftime("%Y-%m"), "categories": rows,
            "income": m(f.income, currency), "expense": m(f.expense, currency), "overlay_50_30_20": overlay,
            "unconverted": sorted(f.unconverted)}


def forecast(db: Session, ws: str, currency: str, today: date, days: int = 90) -> dict:
    """Money Pulse: projected balance from today's confirmed balance + scheduled renewals + recent daily run-rate.

    The run-rate only uses confirmed non-subscription income/expense from the last 90 days and is only applied
    when there are at least 30 days of history. Everything returned here is a FORECAST, not a confirmed figure.
    """
    conv = Converter(db, currency, ws)
    start_bal, _, acc_rows = balances(db, ws, conv, today)
    if not acc_rows:
        return {"currency": currency, "status": "no_accounts", "points": [], "events": []}
    hist_start = today - timedelta(days=90)
    txns = list(db.scalars(select(Transaction).where(Transaction.workspace_id == ws, Transaction.status == "confirmed",
                                                      Transaction.kind.in_(("income", "expense")),
                                                      Transaction.subscription_id.is_(None),
                                                      Transaction.txn_date > hist_start, Transaction.txn_date <= today)))
    first_txn = db.scalar(select(Transaction.txn_date).where(Transaction.workspace_id == ws, Transaction.kind != "opening")
                          .order_by(Transaction.txn_date).limit(1))
    history_days = (today - first_txn).days if first_txn else 0
    daily = Decimal(0)
    if history_days >= 30:
        net = 0
        for t in txns:
            c = conv(Money(t.amount_minor, t.currency), t.txn_date)
            if c:
                net += c.minor if t.kind == "income" else -c.minor
        daily = Decimal(net) / Decimal(min(history_days, 90))
    end = today + timedelta(days=days)
    events = defaultdict(int)
    ev_list = []
    for s in db.scalars(select(Subscription).where(Subscription.workspace_id == ws)):
        for d in subs.renewals_between(s, today + timedelta(days=1), end):
            c = conv(Money(s.amount_minor, s.currency), today)
            if c is None:
                continue
            delta = c.minor if s.direction == "incoming" else -c.minor
            events[d] += delta
            ev_list.append({"date": d.isoformat(), "name": s.name, "kind": s.kind, "amount": m(delta, currency)})
    points, bal, low, low_day, runway = [], Decimal(start_bal), Decimal(start_bal), today, None
    for i in range(days + 1):
        d = today + timedelta(days=i)
        if i:
            bal += daily + events.get(d, 0)
        if bal < low:
            low, low_day = bal, d
        if runway is None and bal < 0:
            runway = i
        if i % 3 == 0 or d in events or i == days:
            points.append({"date": d.isoformat(), "balance": m(int(bal.to_integral_value()), currency)})
    ev_list.sort(key=lambda e: e["date"])
    return {"currency": currency, "status": "ok", "kind": "forecast", "history_days": history_days,
            "run_rate_applied": history_days >= 30, "daily_run_rate": m(int(daily.to_integral_value()), currency),
            "start": m(start_bal, currency), "end": m(int(bal.to_integral_value()), currency),
            "lowest": {"date": low_day.isoformat(), "balance": m(int(low.to_integral_value()), currency)},
            "days_until_negative": runway, "points": points, "events": ev_list[:60],
            "unconverted": sorted(conv.missing)}


def retirement_limits(db: Session, ws: str, today: date) -> list[dict]:
    """IKE / IKZE contribution trackers: confirmed inflows into those accounts this calendar year vs the official limit."""
    out = []
    for a in _accounts(db, ws):
        lim = RETIREMENT_LIMITS_2026.get(a.kind)
        if not lim or a.currency != "PLN" or today.year != 2026:
            continue
        ystart, yend = date(today.year, 1, 1), date(today.year, 12, 31)
        q = select(Transaction).where(Transaction.workspace_id == ws, Transaction.status == "confirmed",
                                      Transaction.txn_date >= ystart, Transaction.txn_date <= yend)
        contributed = 0
        for t in db.scalars(q):
            if t.kind == "transfer" and t.to_account_id == a.id:
                contributed += t.to_amount_minor or t.amount_minor
            elif t.kind == "income" and t.account_id == a.id:
                contributed += t.amount_minor
        out.append({"account_id": a.id, "name": a.name, "kind": a.kind, "label": lim["label"],
                    "limit": m(lim["limit_minor"], "PLN"), "contributed": m(contributed, "PLN"),
                    "remaining": m(max(lim["limit_minor"] - contributed, 0), "PLN"), "source": lim["source"]})
    return out


def signals(db: Session, ws: str, currency: str, today: date) -> list[dict]:
    """Hub Signals: rule-based observations from the owner's own records (no invented figures)."""
    out: list[dict] = []
    all_subs = list(db.scalars(select(Subscription).where(Subscription.workspace_id == ws)))
    by_id = {s.id: s for s in all_subs}
    for group in subs.duplicates(all_subs):
        names = ", ".join(by_id[i].name for i in group)
        out.append({"type": "duplicate_subscription", "severity": "warning",
                    "title": "Possible double subscription", "detail": f"{names} look like the same service.",
                    "ids": group})
    soon = today + timedelta(days=7)
    for s in all_subs:
        if subs.is_live(s) and s.next_renewal and today <= s.next_renewal <= soon:
            label = "Trial ends" if s.status == "trial" else "Renews"
            out.append({"type": "renewal_soon", "severity": "info" if s.status != "trial" else "warning",
                        "title": f"{label} {s.next_renewal.isoformat()}: {s.name}",
                        "detail": f"{format_plain(s.amount_minor, s.currency)} {s.currency} · {s.interval}", "ids": [s.id]})
        if subs.is_live(s) and s.next_renewal and s.next_renewal < today:
            out.append({"type": "renewal_overdue", "severity": "warning", "title": f"Renewal date passed: {s.name}",
                        "detail": "Record the payment or update the renewal date.", "ids": [s.id]})
    for b in db.scalars(select(Budget).where(Budget.workspace_id == ws)):
        bs = budgets.status(db, b, today)
        if bs.state != "on_track":
            pct = (bs.committed_utilization * 100).quantize(Decimal("1"))
            out.append({"type": f"budget_{bs.state}", "severity": "danger" if bs.state == "exceeded" else "warning",
                        "title": f"{b.name}: {pct}% used or reserved",
                        "detail": f"{format_plain(bs.available_minor, b.currency)} {b.currency} available this month",
                        "ids": [b.id]})
    conv = Converter(db, currency, ws)
    balances(db, ws, conv, today)
    if conv.stale and not conv.missing:
        out.append({"type": "stale_rate", "severity": "warning",
                    "title": "Exchange rate out of date",
                    "detail": f"The rate for {', '.join(sorted(conv.stale))} → {currency} is older than 2 Polish business days. Amounts still convert, and the date is shown.",
                    "ids": []})
    if conv.missing:
        stale = sorted(conv.stale & conv.missing)
        out.append({"type": "stale_rate" if stale else "missing_rate", "severity": "warning",
                    "title": "Exchange rate out of date" if stale else "Exchange rate needed",
                    "detail": f"No current rate for {', '.join(sorted(conv.missing))} → {currency}"
                              f"{' (latest on file is too old)' if stale else ''}. Those amounts are left out of totals "
                              "until you sync official rates in Settings.", "ids": []})
    for r in retirement_limits(db, ws, today):
        if r["remaining"]["minor"] == 0:
            out.append({"type": "limit_reached", "severity": "info", "title": f"{r['label']} reached",
                        "detail": r["name"], "ids": [r["account_id"]]})
    return out


class _SameCurrency:
    """A 'converter' that only passes amounts already in `to` (used for per-currency totals, no FX)."""

    def __init__(self, to: str):
        self.to = to
        self.missing: set[str] = set()
        self.stale: set[str] = set()

    def exact(self, money: Money, on: date | None = None):
        return money.amount if money.currency == self.to else None

    def __call__(self, money: Money, on: date | None = None) -> Money | None:
        return money if money.currency == self.to else None


def service_summary(db: Session, ws: str, today: date) -> dict:
    """RAGI-facing summary (ecosystem-contracts finance-summary): per currency, never summed across currencies."""
    from app.core.money import CURRENCIES

    start, end = month_start(today), month_end(today)
    per: dict[str, dict] = {}
    for cur in CURRENCIES:
        only = _SameCurrency(cur)
        bal, pend, _ = balances(db, ws, only, today)
        f = compute_flows(db, ws, start, end, only)
        ai = ai_usage_total(db, ws, start, end, only)
        has_accounts = any(a.currency == cur for a in _accounts(db, ws))
        if not (has_accounts or f.income or f.expense or ai):
            continue
        per[cur] = {"balance": m(bal, cur), "pending": m(pend, cur), "income_month": m(f.income, cur),
                    "expenses_month": m(f.expense, cur), "net_month": m(f.net, cur), "ai_usage_month": m(ai, cur)}
    ai_budgets = [budget_view(budgets.status(db, b, today))
                  for b in db.scalars(select(Budget).where(Budget.workspace_id == ws, Budget.scope == "ai"))]
    return {"source": "omh", "schema_version": "1.0", "as_of": today.isoformat(), "month": start.strftime("%Y-%m"),
            "has_data": bool(per or ai_budgets), "by_currency": per,
            "ai_budgets": [{"id": b["id"], "name": b["name"], "provider": b["ai_provider"], "allocated": b["allocated"],
                            "actual": b["actual"], "reserved": b["reserved"], "available": b["available"],
                            "state": b["state"]} for b in ai_budgets],
            "note": "Amounts are per currency and are never added across currencies."}
