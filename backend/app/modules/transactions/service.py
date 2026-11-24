"""Transactions: user-facing records backed by balanced journal entries.

Posted history is never edited in place. Corrections are made with reversing entries.
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import normalize_currency
from app.database.models import FinancialAccount, LedgerAccount, Transaction, TransactionCategory
from app.modules.audit.service import audit
from app.modules.ledger import service as ledger
from app.modules.workspaces.service import create_category


ACCOUNT_KINDS = {"bank", "cash", "card", "savings", "credit", "investment", "mobile_money", "ikimina",
                 "ejo_heza", "ppk", "ike", "ikze"}


class TxnError(ValueError):
    pass


@dataclass
class NewTxn:
    kind: str  # income | expense | transfer
    account_id: str
    amount_minor: int
    currency: str
    txn_date: date
    description: str
    status: str = "confirmed"
    category_id: str | None = None
    payee: str | None = None
    to_account_id: str | None = None
    to_amount_minor: int | None = None
    project: str | None = None
    subscription_id: str | None = None
    source: str = "manual"
    import_hash: str | None = None
    idempotency_key: str | None = None


def get_account(db: Session, ws: str, account_id: str) -> FinancialAccount:
    acc = db.get(FinancialAccount, account_id)
    if not acc or acc.workspace_id != ws:
        raise TxnError("Account not found in this workspace")
    if acc.archived:
        raise TxnError("Account is archived")
    return acc


def fallback_category(db: Session, ws: str, direction: str) -> TransactionCategory:
    name = "Other income" if direction == "income" else "Other expenses"
    cat = db.scalar(select(TransactionCategory).where(TransactionCategory.workspace_id == ws,
                                                      TransactionCategory.name == name,
                                                      TransactionCategory.direction == direction))
    return cat or create_category(db, ws, name, direction)


def create(db: Session, ws: str, data: NewTxn, user_id: str | None) -> Transaction:
    if data.kind not in {"income", "expense", "transfer"}:
        raise TxnError("kind must be income, expense or transfer")
    if data.status not in {"confirmed", "pending"}:
        raise TxnError("status must be confirmed or pending")
    if data.amount_minor <= 0:
        raise TxnError("Amount must be greater than zero")
    currency = normalize_currency(data.currency)
    acc = get_account(db, ws, data.account_id)
    if acc.currency != currency:
        raise TxnError(f"{acc.name} holds {acc.currency}; this transaction is in {currency}")
    asset = acc.ledger_account_id
    lines: list[ledger.Line]
    cat_id = None
    to_amount = None
    if data.kind in {"income", "expense"}:
        if data.category_id:
            cat = db.get(TransactionCategory, data.category_id)
            if not cat or cat.workspace_id != ws:
                raise TxnError("Category not found in this workspace")
            if cat.direction != data.kind:
                raise TxnError(f"Category '{cat.name}' is for {cat.direction}, not {data.kind}")
        else:
            cat = fallback_category(db, ws, data.kind)
        cat_id = cat.id
        if data.kind == "income":
            lines = [ledger.Line(asset, currency, debit=data.amount_minor),
                     ledger.Line(cat.ledger_account_id, currency, credit=data.amount_minor)]
        else:
            lines = [ledger.Line(cat.ledger_account_id, currency, debit=data.amount_minor),
                     ledger.Line(asset, currency, credit=data.amount_minor)]
    else:
        if not data.to_account_id or data.to_account_id == data.account_id:
            raise TxnError("Choose a different destination account for a transfer")
        dest = get_account(db, ws, data.to_account_id)
        if dest.currency == currency:
            if data.to_amount_minor not in (None, data.amount_minor):
                raise TxnError("Same-currency transfers move the same amount")
            to_amount = data.amount_minor
            lines = [ledger.Line(dest.ledger_account_id, currency, debit=data.amount_minor),
                     ledger.Line(asset, currency, credit=data.amount_minor)]
        else:
            if not data.to_amount_minor or data.to_amount_minor <= 0:
                raise TxnError(f"Enter the amount received in {dest.currency}")
            to_amount = data.to_amount_minor
            fx_from = ledger.fx_clearing(db, ws, currency)
            fx_to = ledger.fx_clearing(db, ws, dest.currency)
            lines = [ledger.Line(fx_from.id, currency, debit=data.amount_minor),
                     ledger.Line(asset, currency, credit=data.amount_minor),
                     ledger.Line(dest.ledger_account_id, dest.currency, debit=to_amount),
                     ledger.Line(fx_to.id, dest.currency, credit=to_amount)]
    entry = ledger.post(db, workspace_id=ws, entry_date=data.txn_date, memo=data.description, status=data.status,
                        lines=lines, user_id=user_id)
    txn = Transaction(workspace_id=ws, kind=data.kind, status=data.status, txn_date=data.txn_date,
                      description=data.description.strip()[:255] or data.kind.title(), payee=data.payee,
                      amount_minor=data.amount_minor, currency=currency, account_id=acc.id,
                      to_account_id=data.to_account_id if data.kind == "transfer" else None,
                      to_amount_minor=to_amount, category_id=cat_id, project=data.project,
                      subscription_id=data.subscription_id, journal_entry_id=entry.id,
                      source=data.source, import_hash=data.import_hash, idempotency_key=data.idempotency_key)
    db.add(txn)
    db.flush()
    audit(db, workspace_id=ws, user_id=user_id, action="transaction.created", entity="transaction", entity_id=txn.id,
          detail={"kind": data.kind, "amount_minor": data.amount_minor, "currency": currency, "status": data.status})
    return txn


def opening_balance(db: Session, ws: str, acc: FinancialAccount, amount_minor: int, on: date,
                    user_id: str | None) -> Transaction | None:
    if amount_minor == 0:
        return None
    eq = ledger.opening_equity(db, ws, acc.currency)
    amt = abs(amount_minor)
    if amount_minor > 0:
        lines = [ledger.Line(acc.ledger_account_id, acc.currency, debit=amt), ledger.Line(eq.id, acc.currency, credit=amt)]
    else:
        lines = [ledger.Line(eq.id, acc.currency, debit=amt), ledger.Line(acc.ledger_account_id, acc.currency, credit=amt)]
    entry = ledger.post(db, workspace_id=ws, entry_date=on, memo=f"Opening balance · {acc.name}", status="confirmed",
                        lines=lines, user_id=user_id)
    txn = Transaction(workspace_id=ws, kind="opening", status="confirmed", txn_date=on,
                      description=f"Opening balance{' (owed)' if amount_minor < 0 else ''}", amount_minor=amt,
                      currency=acc.currency, account_id=acc.id, journal_entry_id=entry.id)
    db.add(txn)
    db.flush()
    return txn


def reverse(db: Session, ws: str, txn_id: str, on: date, user_id: str | None, reason: str | None) -> Transaction:
    txn = db.get(Transaction, txn_id)
    if not txn or txn.workspace_id != ws:
        raise TxnError("Transaction not found")
    if txn.kind == "reversal":
        raise TxnError("A reversal cannot itself be reversed; record a new transaction instead")
    if txn.reversed_by_id:
        raise TxnError("This transaction has already been reversed")
    from app.database.models import JournalEntry

    entry = db.get(JournalEntry, txn.journal_entry_id)
    rev_entry = ledger.reverse(db, entry, entry_date=on, user_id=user_id, memo=f"Reversal: {txn.description}")
    rev = Transaction(workspace_id=ws, kind="reversal", status=txn.status, txn_date=on,
                      description=f"Reversal · {txn.description}"[:255], payee=reason, amount_minor=txn.amount_minor,
                      currency=txn.currency, account_id=txn.account_id, to_account_id=txn.to_account_id,
                      to_amount_minor=txn.to_amount_minor, category_id=txn.category_id, project=txn.project,
                      subscription_id=txn.subscription_id, journal_entry_id=rev_entry.id, reversal_of_id=txn.id)
    db.add(rev)
    db.flush()
    txn.reversed_by_id = rev.id
    audit(db, workspace_id=ws, user_id=user_id, action="transaction.reversed", entity="transaction", entity_id=txn.id,
          detail={"reversal_id": rev.id, "reason": reason})
    return rev


def signed_effect(txn: Transaction, original_kind: str | None = None) -> tuple[str, int]:
    """(kind, sign) for reporting. Reversals count against the kind they reverse."""
    if txn.kind == "reversal":
        return (original_kind or "unknown", -1)
    return (txn.kind, 1)


def import_hash(ws: str, d: date, amount_minor: int, currency: str, account_id: str, description: str) -> str:
    raw = f"{ws}|{d.isoformat()}|{amount_minor}|{currency}|{account_id}|{description.strip().lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()


def account_balances(db: Session, acc: FinancialAccount) -> dict[str, int]:
    return {
        "confirmed": ledger.ledger_balance(db, acc.ledger_account_id, statuses=("confirmed",)),
        "pending": ledger.ledger_balance(db, acc.ledger_account_id, statuses=("pending",)),
    }


def create_account(db: Session, ws: str, *, name: str, kind: str, currency: str, institution: str | None,
                   color: str | None, opening_minor: int, opening_date: date, user_id: str | None) -> FinancialAccount:
    currency = normalize_currency(currency)
    if kind not in ACCOUNT_KINDS:
        raise TxnError("Unknown account kind")
    la = LedgerAccount(workspace_id=ws, code=f"asset:{uuid.uuid4().hex[:16]}",
                       name=name, type="asset", currency=currency)
    db.add(la)
    db.flush()
    acc = FinancialAccount(workspace_id=ws, name=name.strip(), kind=kind, currency=currency, institution=institution,
                           color=color, ledger_account_id=la.id)
    db.add(acc)
    db.flush()
    opening_balance(db, ws, acc, opening_minor, opening_date, user_id)
    audit(db, workspace_id=ws, user_id=user_id, action="account.created", entity="account", entity_id=acc.id,
          detail={"currency": currency, "opening_minor": opening_minor})
    return acc
