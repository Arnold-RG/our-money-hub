"""Cash-basis personal P&L.

N = I − (L + U)
P&L % = N / I × 100
savings rate = S / I × 100

Half-up rounding is applied once, to each displayed total, after summing exact
converted amounts. Official rates are used as published, never rounded before
converting. Refunds reduce their original category on a cash basis (the refund's
occurred_on). When I is 0, margin and savings rate are None (shown as —).
Period bounds use Europe/Warsaw calendar dates.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import CURRENCIES, Money, convert
from app.database.models import PersonalFinanceEntry
from app.modules.currencies.service import get_rate_ex

CATEGORIES = ("income", "living", "usage", "savings")
# Alias used in the formula.
FORMULA = "N = I - (L + U); P&L% = N/I × 100; savings rate = S/I × 100"


def period_bounds(period: str) -> tuple[date, date]:
    """Accept 'YYYY-MM' or 'YYYY'."""
    if len(period) == 7 and period[4] == "-":
        y, m = int(period[:4]), int(period[5:7])
        return date(y, m, 1), date(y, m, monthrange(y, m)[1])
    if len(period) == 4 and period.isdigit():
        y = int(period)
        return date(y, 1, 1), date(y, 12, 31)
    raise ValueError("Period must be YYYY-MM or YYYY")


def _exact(db: Session, entry: PersonalFinanceEntry, reporting: str, ws: str) -> tuple[Decimal | None, bool, str | None]:
    """Return exact reporting-currency amount (not rounded), stale flag, and missing currency."""
    if entry.currency == reporting:
        scale = CURRENCIES[reporting]
        return Decimal(entry.amount_minor) / (Decimal(10) ** scale), False, None
    q, stale = get_rate_ex(db, entry.currency, reporting, entry.occurred_on, ws)
    if not q:
        return None, stale, entry.currency
    scale = CURRENCIES[entry.currency]
    major = Decimal(entry.amount_minor) / (Decimal(10) ** scale)
    return major * q.rate, stale, None  # published rate × exact major; no pre-rounding


def _half_up(amount: Decimal, currency: str) -> int:
    scale = CURRENCIES[currency]
    q = Decimal(10) ** scale
    rounded = (amount * q).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(rounded)


def calculate(db: Session, workspace_id: str, reporting: str, start: date, end: date) -> dict:
    rows = db.scalars(
        select(PersonalFinanceEntry)
        .where(PersonalFinanceEntry.workspace_id == workspace_id,
               PersonalFinanceEntry.occurred_on >= start,
               PersonalFinanceEntry.occurred_on <= end)
        .order_by(PersonalFinanceEntry.occurred_on, PersonalFinanceEntry.created_at)
    ).all()
    exact = {c: Decimal("0") for c in CATEGORIES}
    counts = {c: 0 for c in CATEGORIES}
    stale: set[str] = set()
    missing: set[str] = set()
    items: list[dict] = []
    for row in rows:
        amt, is_stale, miss = _exact(db, row, reporting, workspace_id)
        if miss:
            missing.add(miss)
        if is_stale:
            stale.add(row.currency)
        if amt is None:
            items.append(_item(row, None))
            continue
        signed = -amt if row.is_refund else amt
        exact[row.category] += signed
        counts[row.category] += 1
        items.append(_item(row, signed))

    empty = len(rows) == 0
    rounded = {c: _half_up(exact[c], reporting) for c in CATEGORIES}
    income, living, usage, savings = (rounded["income"], rounded["living"], rounded["usage"], rounded["savings"])
    net = _half_up(exact["income"] - (exact["living"] + exact["usage"]), reporting)

    def ratio(num: int, den: int) -> str | None:
        if den == 0:
            return None
        pct = (Decimal(num) / Decimal(den) * Decimal(100)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        return format(pct, "f")

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "reporting_currency": reporting,
        "basis": "cash",
        "rounding": "half-up-once",
        "formula": FORMULA,
        "empty": empty,
        "income": income,
        "living": living,
        "usage": usage,
        "savings": savings,
        "net": net,  # N = I - (L+U)
        "pnl_pct": ratio(net, income),          # — when I is 0
        "savings_rate_pct": ratio(savings, income),
        "counts": counts,
        "stale_currencies": sorted(stale),
        "unconverted": sorted(missing),
        "entries": items,
    }


def _item(row: PersonalFinanceEntry, exact: Decimal | None) -> dict:
    return {
        "id": row.id,
        "category": row.category,
        "label": row.label,
        "amount_minor": row.amount_minor,
        "currency": row.currency,
        "occurred_on": row.occurred_on.isoformat(),
        "notes": row.notes,
        "is_refund": row.is_refund,
    }
