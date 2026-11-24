"""CSV import (preview → commit, deduplicated) and export. Amounts are parsed exactly; no floats anywhere."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import MoneyError, format_plain, normalize_currency, parse_amount
from app.database.models import FinancialAccount, Transaction, TransactionCategory
from app.modules.transactions import service as txns
from app.modules.workspaces.service import create_category

REQUIRED = {"date", "description", "amount", "currency", "account"}
EXPORT_COLUMNS = ["id", "date", "kind", "status", "description", "payee", "amount", "currency", "account",
                  "to_account", "to_amount", "category", "project", "source", "reversal_of"]


@dataclass
class Row:
    line: int
    raw: dict
    errors: list[str] = field(default_factory=list)
    duplicate: bool = False
    parsed: dict | None = None


def _parse_date(s: str) -> date:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            from datetime import datetime

            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date {s!r} (use YYYY-MM-DD)")


def parse_csv(db: Session, ws: str, text: str) -> list[Row]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    headers = {h.strip().lower() for h in (reader.fieldnames or [])}
    missing = REQUIRED - headers
    if missing:
        raise ValueError(f"CSV is missing column(s): {', '.join(sorted(missing))}")
    accounts = {a.name.strip().lower(): a for a in db.scalars(select(FinancialAccount).where(
        FinancialAccount.workspace_id == ws, FinancialAccount.archived.is_(False)))}
    rows: list[Row] = []
    seen: set[str] = set()
    for i, raw in enumerate(reader, start=2):
        raw = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        r = Row(line=i, raw=raw)
        try:
            d = _parse_date(raw["date"])
        except ValueError as e:
            r.errors.append(str(e))
            d = None
        try:
            cur = normalize_currency(raw["currency"])
            signed = parse_amount(raw["amount"], cur)
            if signed == 0:
                r.errors.append("Amount is zero")
        except MoneyError as e:
            r.errors.append(str(e))
            cur, signed = None, None
        acc = accounts.get(raw["account"].lower())
        if not acc:
            r.errors.append(f"No account named {raw['account']!r} in this workspace")
        elif cur and acc.currency != cur:
            r.errors.append(f"{acc.name} holds {acc.currency}, row is {cur}")
        status = (raw.get("status") or "confirmed").lower()
        if status not in {"confirmed", "pending"}:
            r.errors.append("status must be confirmed or pending")
        explicit = (raw.get("kind") or "").lower()
        if explicit and explicit not in {"income", "expense"}:
            r.errors.append(f"Rows of kind {explicit!r} can't be imported; record transfers and reversals in the app")
        if not r.errors:
            kind = explicit or ("income" if signed > 0 else "expense")
            h = txns.import_hash(ws, d, signed, cur, acc.id, raw["description"])
            exists = db.scalar(select(Transaction.id).where(Transaction.workspace_id == ws, Transaction.import_hash == h))
            r.duplicate = bool(exists) or h in seen
            seen.add(h)
            r.parsed = {"kind": kind, "date": d, "amount_minor": abs(signed), "currency": cur, "account_id": acc.id,
                        "account": acc.name, "description": raw["description"][:255] or kind.title(),
                        "payee": raw.get("payee") or None, "category": raw.get("category") or None,
                        "project": raw.get("project") or None, "status": status, "hash": h}
        rows.append(r)
    return rows


def commit(db: Session, ws: str, rows: list[Row], user_id: str | None) -> int:
    cats = {(c.name.lower(), c.direction): c for c in db.scalars(select(TransactionCategory).where(
        TransactionCategory.workspace_id == ws))}
    n = 0
    for r in rows:
        if r.errors or r.duplicate or not r.parsed:
            continue
        p = r.parsed
        cat_id = None
        if p["category"]:
            key = (p["category"].lower(), p["kind"])
            if key not in cats:
                cats[key] = create_category(db, ws, p["category"][:80], p["kind"])
            cat_id = cats[key].id
        txns.create(db, ws, txns.NewTxn(kind=p["kind"], account_id=p["account_id"], amount_minor=p["amount_minor"],
                                        currency=p["currency"], txn_date=p["date"], description=p["description"],
                                        status=p["status"], category_id=cat_id, payee=p["payee"], project=p["project"],
                                        source="csv", import_hash=p["hash"]), user_id)
        n += 1
    return n


def export_csv(db: Session, ws: str) -> str:
    accounts = {a.id: a.name for a in db.scalars(select(FinancialAccount).where(FinancialAccount.workspace_id == ws))}
    cats = {c.id: c.name for c in db.scalars(select(TransactionCategory).where(TransactionCategory.workspace_id == ws))}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLUMNS)
    for t in db.scalars(select(Transaction).where(Transaction.workspace_id == ws)
                        .order_by(Transaction.txn_date, Transaction.created_at)):
        w.writerow([t.id, t.txn_date.isoformat(), t.kind, t.status, t.description, t.payee or "",
                    format_plain(t.amount_minor, t.currency), t.currency, accounts.get(t.account_id, ""),
                    accounts.get(t.to_account_id, "") if t.to_account_id else "",
                    format_plain(t.to_amount_minor, _dest_currency(db, t)) if t.to_amount_minor and t.to_account_id else "",
                    cats.get(t.category_id, "") if t.category_id else "", t.project or "", t.source,
                    t.reversal_of_id or ""])
    return buf.getvalue()


def _dest_currency(db: Session, t: Transaction) -> str:
    a = db.get(FinancialAccount, t.to_account_id)
    return a.currency if a else t.currency
