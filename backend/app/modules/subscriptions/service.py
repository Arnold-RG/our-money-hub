from __future__ import annotations

import re
from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from app.core.dates import next_occurrence
from app.core.money import Money, monthly_equivalent
from app.database.models import Subscription
from app.modules.audit.service import audit
from app.modules.events.service import emit
from app.modules.transactions import service as txns

KINDS = {"ai", "api", "hosting", "domain", "software", "media", "client", "other"}
INTERVALS = {"weekly", "monthly", "quarterly", "yearly"}
AI_KINDS = {"ai", "api"}
INFRA_KINDS = {"hosting", "domain"}
_SUFFIX = re.compile(r"\b(inc|ltd|llc|sp z o o|gmbh|plc|corp|co)\b")


def vendor_key(v: str) -> str:
    v = re.sub(r"[^a-z0-9 ]+", " ", v.lower())
    v = _SUFFIX.sub(" ", v)
    return re.sub(r"\s+", "", v)


def monthly(s: Subscription) -> Money:
    return monthly_equivalent(Money(s.amount_minor, s.currency), s.interval)


def is_live(s: Subscription) -> bool:
    return s.status in {"active", "trial"}


def duplicates(subs: list[Subscription]) -> list[list[str]]:
    """Groups of live outgoing subscriptions that look like the same service paid twice."""
    groups: dict[str, list[str]] = defaultdict(list)
    for s in subs:
        if is_live(s) and s.direction == "outgoing":
            groups[vendor_key(s.vendor) + "|" + s.kind].append(s.id)
    return [ids for ids in groups.values() if len(ids) > 1]


def record_payment(db: Session, s: Subscription, *, on: date | None, user_id: str | None):
    if not s.account_id:
        raise txns.TxnError("Link an account to this subscription before recording a payment")
    pay_date = on or s.next_renewal or date.today()
    kind = "income" if s.direction == "incoming" else "expense"
    t = txns.create(db, s.workspace_id, txns.NewTxn(
        kind=kind, account_id=s.account_id, amount_minor=s.amount_minor, currency=s.currency, txn_date=pay_date,
        description=f"{s.name} ({s.interval})", payee=s.vendor, category_id=s.category_id, project=s.project,
        subscription_id=s.id, source="subscription"), user_id)
    base = s.next_renewal or pay_date
    s.next_renewal = next_occurrence(base, s.interval)
    while s.next_renewal <= pay_date:
        s.next_renewal = next_occurrence(s.next_renewal, s.interval)
    emit(db, workspace_id=s.workspace_id, event_type="subscription.updated",
         data={"subscription_id": s.id, "status": s.status, "next_renewal": s.next_renewal.isoformat(),
               "paid_transaction_id": t.id})
    audit(db, workspace_id=s.workspace_id, user_id=user_id, action="subscription.paid", entity="subscription",
          entity_id=s.id, detail={"transaction_id": t.id})
    return t


def renewals_between(s: Subscription, start: date, end: date) -> list[date]:
    if not is_live(s) or not s.next_renewal:
        return []
    out, d = [], s.next_renewal
    while d < start:
        d = next_occurrence(d, s.interval)
    while d <= end:
        out.append(d)
        d = next_occurrence(d, s.interval)
    return out
