"""Double-entry ledger. Every posted entry must balance per currency."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.money import normalize_currency
from app.database.models import JournalEntry, JournalEntryLine, LedgerAccount


class LedgerError(ValueError):
    pass


@dataclass
class Line:
    ledger_account_id: str
    currency: str
    debit: int = 0
    credit: int = 0


def system_account(db: Session, workspace_id: str, code: str, name: str, type_: str,
                   currency: str | None = None) -> LedgerAccount:
    la = db.scalar(select(LedgerAccount).where(LedgerAccount.workspace_id == workspace_id,
                                               LedgerAccount.code == code))
    if not la:
        la = LedgerAccount(workspace_id=workspace_id, code=code, name=name, type=type_, currency=currency)
        db.add(la)
        db.flush()
    return la


def opening_equity(db: Session, ws: str, currency: str) -> LedgerAccount:
    return system_account(db, ws, f"equity:opening:{currency}", f"Opening balance equity ({currency})", "equity", currency)


def fx_clearing(db: Session, ws: str, currency: str) -> LedgerAccount:
    return system_account(db, ws, f"equity:fx:{currency}", f"Currency exchange clearing ({currency})", "equity", currency)


def validate_lines(lines: list[Line]) -> None:
    if len(lines) < 2:
        raise LedgerError("A journal entry needs at least two lines")
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for ln in lines:
        normalize_currency(ln.currency)
        if ln.debit < 0 or ln.credit < 0:
            raise LedgerError("Debit/credit must be non-negative")
        if (ln.debit == 0) == (ln.credit == 0):
            raise LedgerError("Each line must have exactly one of debit or credit")
        totals[ln.currency][0] += ln.debit
        totals[ln.currency][1] += ln.credit
    for cur, (d, c) in totals.items():
        if d != c:
            raise LedgerError(f"Entry does not balance in {cur}: debits {d} != credits {c}")


def post(db: Session, *, workspace_id: str, entry_date: date, memo: str, status: str, lines: list[Line],
         user_id: str | None, reverses_entry_id: str | None = None) -> JournalEntry:
    validate_lines(lines)
    if status not in {"confirmed", "pending"}:
        raise LedgerError("Only confirmed or pending entries can be posted")
    entry = JournalEntry(workspace_id=workspace_id, entry_date=entry_date, memo=memo[:255], status=status,
                         created_by=user_id, reverses_entry_id=reverses_entry_id)
    for ln in lines:
        entry.lines.append(JournalEntryLine(ledger_account_id=ln.ledger_account_id, currency=ln.currency,
                                            debit_minor=ln.debit, credit_minor=ln.credit))
    db.add(entry)
    db.flush()
    return entry


def reverse(db: Session, entry: JournalEntry, *, entry_date: date, user_id: str | None, memo: str) -> JournalEntry:
    lines = [Line(l.ledger_account_id, l.currency, debit=l.credit_minor, credit=l.debit_minor) for l in entry.lines]
    return post(db, workspace_id=entry.workspace_id, entry_date=entry_date, memo=memo, status=entry.status,
                lines=lines, user_id=user_id, reverses_entry_id=entry.id)


def ledger_balance(db: Session, ledger_account_id: str, *, statuses: tuple[str, ...] = ("confirmed",),
                   as_of: date | None = None) -> int:
    """Debit-positive balance in minor units (assets are positive)."""
    q = (select(func.coalesce(func.sum(JournalEntryLine.debit_minor - JournalEntryLine.credit_minor), 0))
         .join(JournalEntry, JournalEntry.id == JournalEntryLine.entry_id)
         .where(JournalEntryLine.ledger_account_id == ledger_account_id, JournalEntry.status.in_(statuses)))
    if as_of:
        q = q.where(JournalEntry.entry_date <= as_of)
    return int(db.scalar(q) or 0)


def trial_balance(db: Session, workspace_id: str) -> dict[str, tuple[int, int]]:
    """Total debits and credits per currency for the workspace (must be equal)."""
    rows = db.execute(
        select(JournalEntryLine.currency, func.sum(JournalEntryLine.debit_minor), func.sum(JournalEntryLine.credit_minor))
        .join(JournalEntry, JournalEntry.id == JournalEntryLine.entry_id)
        .where(JournalEntry.workspace_id == workspace_id)
        .group_by(JournalEntryLine.currency)
    ).all()
    return {cur: (int(d or 0), int(c or 0)) for cur, d, c in rows}
