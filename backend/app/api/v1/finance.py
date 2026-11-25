"""Workspaces, accounts, categories, transactions, CSV import/export."""
from __future__ import annotations

import datetime as dt
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.v1.common import money_out, parse_money, today
from app.core.money import CURRENCIES
from app.core.permissions import WorkspaceContext, read_ws, write_ws
from app.database.models import FinancialAccount, FinancialWorkspace, Transaction, TransactionCategory
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.budgets import service as budgets
from app.modules.imports import service as imports
from app.modules.ledger.service import trial_balance
from app.modules.transactions import service as txns
from app.modules.workspaces.service import create_category

router = APIRouter(tags=["finance"])


# ---------- workspace ----------
class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    base_currency: str | None = None


@router.patch("/workspaces/current")
def update_workspace(body: WorkspaceUpdate, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    ws = db.get(FinancialWorkspace, ctx.workspace_id)
    if body.name:
        ws.name = body.name.strip()
    if body.base_currency:
        if body.base_currency.upper() not in CURRENCIES:
            raise HTTPException(422, "Unsupported currency")
        ws.base_currency = body.base_currency.upper()
    audit(db, workspace_id=ws.id, user_id=ctx.user.id, action="workspace.updated", entity="workspace", entity_id=ws.id)
    db.commit()
    return {"id": ws.id, "name": ws.name, "kind": ws.kind, "base_currency": ws.base_currency}


@router.get("/ledger/trial-balance")
def get_trial_balance(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    tb = trial_balance(db, ctx.workspace_id)
    return {"balanced": all(d == c for d, c in tb.values()),
            "currencies": {k: {"debits": money_out(d, k), "credits": money_out(c, k)} for k, (d, c) in tb.items()}}


# ---------- accounts ----------
class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = "bank"
    currency: str
    institution: str | None = Field(default=None, max_length=120)
    color: str | None = Field(default=None, max_length=16)
    opening_balance: str = "0"
    opening_date: date | None = None


def account_view(db: Session, a: FinancialAccount) -> dict:
    b = txns.account_balances(db, a)
    return {"id": a.id, "name": a.name, "kind": a.kind, "currency": a.currency, "institution": a.institution,
            "color": a.color, "archived": a.archived, "balance": money_out(b["confirmed"], a.currency),
            "pending": money_out(b["pending"], a.currency)}


@router.get("/accounts")
def list_accounts(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(FinancialAccount).where(FinancialAccount.workspace_id == ctx.workspace_id)
                      .order_by(FinancialAccount.archived, FinancialAccount.created_at))
    return [account_view(db, a) for a in rows]


@router.post("/accounts", status_code=201)
def create_account(body: AccountIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    opening, cur = parse_money(body.opening_balance or "0", body.currency, "opening_balance")
    try:
        a = txns.create_account(db, ctx.workspace_id, name=body.name, kind=body.kind, currency=cur,
                                institution=body.institution, color=body.color, opening_minor=opening,
                                opening_date=body.opening_date or today(), user_id=ctx.user.id)
    except txns.TxnError as e:
        raise HTTPException(422, str(e)) from e
    db.commit()
    return account_view(db, a)


@router.post("/accounts/{account_id}/archive")
def archive_account(account_id: str, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    a = db.get(FinancialAccount, account_id)
    if not a or a.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Account not found")
    a.archived = True
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="account.archived", entity="account",
          entity_id=a.id)
    db.commit()
    return account_view(db, a)


# ---------- categories ----------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    direction: str
    bucket: str | None = None


@router.get("/categories")
def list_categories(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(TransactionCategory).where(TransactionCategory.workspace_id == ctx.workspace_id)
                      .order_by(TransactionCategory.direction, TransactionCategory.name))
    return [{"id": c.id, "name": c.name, "direction": c.direction, "icon": c.icon, "bucket": c.bucket} for c in rows]


@router.post("/categories", status_code=201)
def add_category(body: CategoryIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    if body.direction not in {"income", "expense"}:
        raise HTTPException(422, "direction must be income or expense")
    if body.bucket not in {None, "needs", "wants", "savings"}:
        raise HTTPException(422, "bucket must be needs, wants or savings")
    exists = db.scalar(select(TransactionCategory).where(TransactionCategory.workspace_id == ctx.workspace_id,
                                                         TransactionCategory.name == body.name.strip(),
                                                         TransactionCategory.direction == body.direction))
    if exists:
        raise HTTPException(409, "That category already exists")
    c = create_category(db, ctx.workspace_id, body.name.strip(), body.direction, None, body.bucket)
    db.commit()
    return {"id": c.id, "name": c.name, "direction": c.direction, "icon": c.icon, "bucket": c.bucket}


class CategoryPatch(BaseModel):
    bucket: str | None = None


@router.patch("/categories/{cid}")
def patch_category(cid: str, body: CategoryPatch, ctx: WorkspaceContext = Depends(write_ws),
                   db: Session = Depends(get_db)):
    c = db.get(TransactionCategory, cid)
    if not c or c.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Category not found")
    if body.bucket not in {None, "needs", "wants", "savings"}:
        raise HTTPException(422, "bucket must be needs, wants or savings")
    c.bucket = body.bucket
    db.commit()
    return {"id": c.id, "name": c.name, "direction": c.direction, "icon": c.icon, "bucket": c.bucket}


# ---------- transactions ----------
class TxnIn(BaseModel):
    kind: str
    account_id: str
    amount: str
    currency: str
    date: dt.date
    description: str = Field(min_length=1, max_length=255)
    status: str = "confirmed"
    category_id: str | None = None
    payee: str | None = Field(default=None, max_length=160)
    to_account_id: str | None = None
    to_amount: str | None = None
    project: str | None = Field(default=None, max_length=120)
    is_refund: bool = False
    refund_of_id: str | None = None


class ReverseIn(BaseModel):
    reason: str | None = Field(default=None, max_length=160)
    date: dt.date | None = None


class TxnPatch(BaseModel):
    """Only non-financial fields can change in place; amounts/accounts/categories need a reversal."""

    payee: str | None = Field(default=None, max_length=160)
    project: str | None = Field(default=None, max_length=120)


def txn_view(t: Transaction, accounts: dict, cats: dict) -> dict:
    to_cur = accounts[t.to_account_id].currency if t.to_account_id and t.to_account_id in accounts else t.currency
    return {"id": t.id, "kind": t.kind, "status": t.status, "date": t.txn_date.isoformat(), "description": t.description,
            "payee": t.payee, "amount": money_out(t.amount_minor, t.currency), "account_id": t.account_id,
            "account": accounts[t.account_id].name if t.account_id in accounts else None,
            "to_account_id": t.to_account_id,
            "to_account": accounts[t.to_account_id].name if t.to_account_id in accounts else None,
            "to_amount": money_out(t.to_amount_minor, to_cur) if t.to_amount_minor else None,
            "category_id": t.category_id, "category": cats[t.category_id].name if t.category_id in cats else None,
            "project": t.project, "source": t.source, "subscription_id": t.subscription_id,
            "reversal_of_id": t.reversal_of_id, "reversed_by_id": t.reversed_by_id,
            "is_refund": t.is_refund, "refund_of_id": t.refund_of_id,
            "journal_entry_id": t.journal_entry_id}


def _maps(db: Session, ws: str):
    accounts = {a.id: a for a in db.scalars(select(FinancialAccount).where(FinancialAccount.workspace_id == ws))}
    cats = {c.id: c for c in db.scalars(select(TransactionCategory).where(TransactionCategory.workspace_id == ws))}
    return accounts, cats


@router.get("/transactions")
def list_transactions(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db),
                      q: str | None = None, kind: str | None = None, account_id: str | None = None,
                      category_id: str | None = None, start: date | None = None, end: date | None = None,
                      limit: int = Query(200, le=1000), offset: int = 0):
    stmt = select(Transaction).where(Transaction.workspace_id == ctx.workspace_id)
    if q:
        like = f"%{q.lower()}%"
        from sqlalchemy import func

        stmt = stmt.where(or_(func.lower(Transaction.description).like(like), func.lower(Transaction.payee).like(like)))
    if kind:
        stmt = stmt.where(Transaction.kind == kind)
    if account_id:
        stmt = stmt.where(or_(Transaction.account_id == account_id, Transaction.to_account_id == account_id))
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if start:
        stmt = stmt.where(Transaction.txn_date >= start)
    if end:
        stmt = stmt.where(Transaction.txn_date <= end)
    rows = db.scalars(stmt.order_by(Transaction.txn_date.desc(), Transaction.created_at.desc()).limit(limit).offset(offset))
    accounts, cats = _maps(db, ctx.workspace_id)
    return [txn_view(t, accounts, cats) for t in rows]


@router.post("/transactions", status_code=201)
def create_transaction(body: TxnIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    amount, cur = parse_money(body.amount, body.currency)
    to_amount = None
    if body.kind == "transfer" and body.to_amount and body.to_account_id:
        dest = db.get(FinancialAccount, body.to_account_id)
        if not dest or dest.workspace_id != ctx.workspace_id:
            raise HTTPException(422, "Destination account not found")
        to_amount, _ = parse_money(body.to_amount, dest.currency, "to_amount")
    try:
        t = txns.create(db, ctx.workspace_id, txns.NewTxn(
            kind=body.kind, account_id=body.account_id, amount_minor=amount, currency=cur, txn_date=body.date,
            description=body.description, status=body.status, category_id=body.category_id, payee=body.payee,
            to_account_id=body.to_account_id, to_amount_minor=to_amount, project=body.project,
            is_refund=body.is_refund, refund_of_id=body.refund_of_id), ctx.user.id)
    except txns.TxnError as e:
        raise HTTPException(422, str(e)) from e
    if t.kind == "expense" and t.status == "confirmed" and t.category_id:
        from app.database.models import Budget

        for b in db.scalars(select(Budget).where(Budget.workspace_id == ctx.workspace_id,
                                                 Budget.category_id == t.category_id)):
            budgets.check_alerts(db, b, t.txn_date)
    db.commit()
    accounts, cats = _maps(db, ctx.workspace_id)
    return txn_view(t, accounts, cats)


@router.patch("/transactions/{txn_id}")
def patch_transaction(txn_id: str, body: TxnPatch, ctx: WorkspaceContext = Depends(write_ws),
                      db: Session = Depends(get_db)):
    t = db.get(Transaction, txn_id)
    if not t or t.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Transaction not found")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(t, k, v)
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="transaction.annotated", entity="transaction",
          entity_id=t.id, detail=changes)
    db.commit()
    accounts, cats = _maps(db, ctx.workspace_id)
    return txn_view(t, accounts, cats)


@router.post("/transactions/{txn_id}/reverse", status_code=201)
def reverse_transaction(txn_id: str, body: ReverseIn, ctx: WorkspaceContext = Depends(write_ws),
                        db: Session = Depends(get_db)):
    try:
        rev = txns.reverse(db, ctx.workspace_id, txn_id, body.date or today(), ctx.user.id, body.reason)
    except txns.TxnError as e:
        raise HTTPException(409, str(e)) from e
    db.commit()
    accounts, cats = _maps(db, ctx.workspace_id)
    return txn_view(rev, accounts, cats)


@router.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: str, ctx: WorkspaceContext = Depends(write_ws)):
    raise HTTPException(405, "Posted transactions are never deleted. Reverse it instead.")


# ---------- CSV ----------
def _rows_view(rows):
    return [{"line": r.line, "errors": r.errors, "duplicate": r.duplicate,
             "parsed": None if not r.parsed else {**{k: v for k, v in r.parsed.items() if k not in {"hash", "date"}},
                                                  "date": r.parsed["date"].isoformat(),
                                                  "amount": money_out(r.parsed["amount_minor"], r.parsed["currency"])}}
            for r in rows]


async def _read_csv(file: UploadFile) -> str:
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV larger than 5 MB")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HTTPException(422, "CSV must be UTF-8") from e


@router.post("/transactions/import/preview")
async def import_preview(file: UploadFile = File(...), ctx: WorkspaceContext = Depends(write_ws),
                         db: Session = Depends(get_db)):
    try:
        rows = imports.parse_csv(db, ctx.workspace_id, await _read_csv(file))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    ok = sum(1 for r in rows if not r.errors and not r.duplicate)
    return {"rows": _rows_view(rows), "importable": ok, "errors": sum(1 for r in rows if r.errors),
            "duplicates": sum(1 for r in rows if r.duplicate)}


@router.post("/transactions/import/commit")
async def import_commit(file: UploadFile = File(...), ctx: WorkspaceContext = Depends(write_ws),
                        db: Session = Depends(get_db)):
    try:
        rows = imports.parse_csv(db, ctx.workspace_id, await _read_csv(file))
        n = imports.commit(db, ctx.workspace_id, rows, ctx.user.id)
    except (ValueError, txns.TxnError) as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="transactions.imported", entity="import",
          detail={"imported": n, "rows": len(rows)})
    db.commit()
    return {"imported": n, "skipped": len(rows) - n}


@router.get("/transactions/export.csv")
def export(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    return Response(imports.export_csv(db, ctx.workspace_id), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="omh-transactions-{today().isoformat()}.csv"'})
