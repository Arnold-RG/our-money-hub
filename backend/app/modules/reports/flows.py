"""Income/expense aggregation in an explicitly selected reporting currency."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import Money
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


def compute_flows(db: Session, ws: str, start: date, end: date, conv: Converter, *,
                  category_id: str | None = None, statuses: tuple[str, ...] = ("confirmed",)) -> Flows:
    q = select(Transaction).where(Transaction.workspace_id == ws, Transaction.txn_date >= start,
                                  Transaction.txn_date <= end, Transaction.status.in_(statuses),
                                  Transaction.kind.in_(("income", "expense", "reversal")))
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    txns = list(db.scalars(q))
    orig_ids = {t.reversal_of_id for t in txns if t.kind == "reversal" and t.reversal_of_id}
    originals = {t.id: t.kind for t in db.scalars(select(Transaction).where(Transaction.id.in_(orig_ids)))} if orig_ids else {}
    f = Flows(currency=conv.to)
    for t in txns:
        kind, sign = (originals.get(t.reversal_of_id, "transfer"), -1) if t.kind == "reversal" else (t.kind, 1)
        if kind not in {"income", "expense"}:
            continue  # reversed transfers/openings don't affect income or expense
        m = conv(Money(t.amount_minor, t.currency), t.txn_date)
        if m is None:
            f.unconverted[t.currency] += 1
            continue
        v = sign * m.minor
        mk = t.txn_date.strftime("%Y-%m")
        if kind == "income":
            f.income += v
            f.by_month[mk][0] += v
        else:
            f.expense += v
            f.by_month[mk][1] += v
            if t.category_id:
                f.by_category[t.category_id] += v
    return f
