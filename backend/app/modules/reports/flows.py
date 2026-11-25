"""Income/expense aggregation in an explicitly selected reporting currency.

Refunds and reversals reduce their original category on a cash basis: they
count on the refund/reversal date, in the original category, as a reduction.
Totals sum exact converted amounts and round half-up once per displayed figure.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import Money, round_report
from app.database.models import Transaction
from app.modules.currencies.service import Converter


@dataclass
class Flows:
    currency: str
    income: int = 0
    expense: int = 0
    by_category: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    by_month: dict[str, list[int]] = field(default_factory=lambda: defaultdict(lambda: [0, 0]))
    unconverted: dict[str, int] = field(default_factory=lambda: defaultdict(int))  # currency -> count

    @property
    def net(self) -> int:
        return self.income - self.expense


def _classify(t: Transaction, originals: dict[str, Transaction]) -> tuple[str, int, str | None]:
    """Return (kind, sign, category_id). Refunds/reversals keep the original category, cash date = t.txn_date."""
    if t.kind == "reversal" and t.reversal_of_id and t.reversal_of_id in originals:
        o = originals[t.reversal_of_id]
        return o.kind, -1, o.category_id
    if getattr(t, "is_refund", False):
        rid = getattr(t, "refund_of_id", None)
        if rid and rid in originals:
            o = originals[rid]
            return o.kind, -1, o.category_id
        return t.kind, -1, t.category_id
    return t.kind, 1, t.category_id


def compute_flows(db: Session, ws: str, start: date, end: date, conv: Converter, *,
                  category_id: str | None = None, statuses: tuple[str, ...] = ("confirmed",)) -> Flows:
    q = select(Transaction).where(Transaction.workspace_id == ws, Transaction.txn_date >= start,
                                  Transaction.txn_date <= end, Transaction.status.in_(statuses),
                                  Transaction.kind.in_(("income", "expense", "reversal")))
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    txns = list(db.scalars(q))
    orig_ids = set()
    for t in txns:
        if t.kind == "reversal" and t.reversal_of_id:
            orig_ids.add(t.reversal_of_id)
        rid = getattr(t, "refund_of_id", None)
        if rid:
            orig_ids.add(rid)
    originals = {t.id: t for t in db.scalars(select(Transaction).where(Transaction.id.in_(orig_ids)))} if orig_ids else {}
    income_e = Decimal(0)
    expense_e = Decimal(0)
    by_cat: dict[str, Decimal] = defaultdict(Decimal)
    by_month: dict[str, list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    unconverted: dict[str, int] = defaultdict(int)
    for t in txns:
        kind, sign, cat_id = _classify(t, originals)
        if kind not in {"income", "expense"}:
            continue  # reversed transfers/openings don't affect income or expense
        exact = conv.exact(Money(t.amount_minor, t.currency), t.txn_date)
        if exact is None:
            unconverted[t.currency] += 1
            continue
        v = sign * exact
        mk = t.txn_date.strftime("%Y-%m")
        if kind == "income":
            income_e += v
            by_month[mk][0] += v
        else:
            expense_e += v
            by_month[mk][1] += v
            if cat_id:
                by_cat[cat_id] += v
    f = Flows(currency=conv.to, income=round_report(income_e, conv.to),
              expense=round_report(expense_e, conv.to), unconverted=unconverted)
    for cid, amt in by_cat.items():
        f.by_category[cid] = round_report(amt, conv.to)
    for mk, (inc, exp) in by_month.items():
        f.by_month[mk] = [round_report(inc, conv.to), round_report(exp, conv.to)]
    return f
