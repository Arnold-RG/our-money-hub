"""My finances (P&L) and future-project budgets."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.common import money_out, parse_money, today
from app.core.money import CURRENCIES
from app.core.permissions import WorkspaceContext, read_ws, write_ws
from app.database.models import FutureProject, PersonalFinanceEntry
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.personal_finance import service as pnl

router = APIRouter(tags=["personal-finance"])
CATS = {"income", "living", "usage", "savings"}


class EntryIn(BaseModel):
    category: str
    label: str = Field(min_length=1, max_length=200)
    amount: str
    currency: str = "PLN"
    occurred_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_refund: bool = False


class EntryPatch(BaseModel):
    label: str | None = Field(default=None, max_length=200)
    amount: str | None = None
    currency: str | None = None
    occurred_on: date | None = None
    notes: str | None = None


def _entry_out(e: PersonalFinanceEntry) -> dict:
    return {"id": e.id, "category": e.category, "label": e.label,
            "amount": money_out(e.amount_minor, e.currency),
            "occurred_on": e.occurred_on.isoformat(), "notes": e.notes,
            "is_refund": e.is_refund}


def _pnl_out(raw: dict) -> dict:
    cur = raw["reporting_currency"]
    return {
        **{k: raw[k] for k in ("period_start", "period_end", "reporting_currency", "basis", "rounding",
                               "formula", "empty", "counts", "stale_currencies", "unconverted")},
        "income": money_out(raw["income"], cur),
        "living": money_out(raw["living"], cur),
        "usage": money_out(raw["usage"], cur),
        "savings": money_out(raw["savings"], cur),
        "net": money_out(raw["net"], cur),
        "pnl_pct": raw["pnl_pct"],            # None → UI shows —
        "savings_rate_pct": raw["savings_rate_pct"],
        "entries": raw["entries"],
    }


@router.get("/my-finances")
def my_finances(period: str | None = None, ctx: WorkspaceContext = Depends(read_ws),
                db: Session = Depends(get_db)):
    reporting = ctx.user.reporting_currency or "PLN"
    try:
        start, end = pnl.period_bounds(period or today().strftime("%Y-%m"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    # Use workspace base currency if we want reporting to follow the switcher:
    # the header currency is the user's reporting_currency (already switched via /auth/me).
    raw = pnl.calculate(db, ctx.workspace_id, reporting, start, end)
    return _pnl_out(raw)


@router.post("/my-finances/entries", status_code=201)
def add_entry(body: EntryIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    if body.category not in CATS:
        raise HTTPException(422, "Category must be income, living, usage or savings")
    amount, cur = parse_money(body.amount, body.currency)
    if amount < 0:
        raise HTTPException(422, "Amount must be zero or more")
    e = PersonalFinanceEntry(
        workspace_id=ctx.workspace_id, category=body.category, label=body.label.strip(),
        amount_minor=amount, currency=cur, occurred_on=body.occurred_on or today(), notes=body.notes,
        is_refund=body.is_refund,
    )
    db.add(e)
    db.flush()
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="personal_finance.created",
          entity="personal_finance_entry", entity_id=e.id)
    db.commit()
    return _entry_out(e)


@router.patch("/my-finances/entries/{eid}")
def patch_entry(eid: str, body: EntryPatch, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    e = db.get(PersonalFinanceEntry, eid)
    if not e or e.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Entry not found")
    if body.label is not None:
        e.label = body.label.strip()
    if body.notes is not None:
        e.notes = body.notes
    if body.occurred_on is not None:
        e.occurred_on = body.occurred_on
    if body.amount is not None or body.currency is not None:
        amount, cur = parse_money(body.amount or str(e.amount_minor / (10 ** {"PLN":2,"EUR":2,"USD":2,"GBP":2,"RWF":0}[e.currency])),
                                  body.currency or e.currency)
        e.amount_minor, e.currency = amount, cur
    db.commit()
    return _entry_out(e)


@router.delete("/my-finances/entries/{eid}")
def delete_entry(eid: str, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    e = db.get(PersonalFinanceEntry, eid)
    if not e or e.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Entry not found")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ---------- future projects (money in OMH, PLN default) ----------
class FutureIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    planned: str
    funded: str = "0"
    currency: str = "PLN"
    target_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class FuturePatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    planned: str | None = None
    funded: str | None = None
    currency: str | None = None
    target_date: date | None = None
    notes: str | None = None


def _fp_out(p: FutureProject) -> dict:
    gap = p.planned_minor - p.funded_minor
    return {
        "id": p.id, "name": p.name,
        "planned": money_out(p.planned_minor, p.currency),
        "funded": money_out(p.funded_minor, p.currency),
        "gap": money_out(gap, p.currency),
        "currency": p.currency,
        "target_date": p.target_date.isoformat() if p.target_date else None,
        "notes": p.notes,
        "behind": bool(p.target_date and p.target_date < today() and gap > 0),
        "funded_fully": p.funded_minor >= p.planned_minor and p.planned_minor > 0,
    }


@router.get("/future-projects")
def list_future(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(FutureProject).where(FutureProject.workspace_id == ctx.workspace_id)
                      .order_by(FutureProject.target_date.is_(None), FutureProject.target_date)).all()
    return [_fp_out(r) for r in rows]


@router.post("/future-projects", status_code=201)
def create_future(body: FutureIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    cur = (body.currency or "PLN").upper()
    if cur not in CURRENCIES:
        raise HTTPException(422, "Unsupported currency")
    planned, cur = parse_money(body.planned, cur)
    funded, _ = parse_money(body.funded, cur)
    p = FutureProject(workspace_id=ctx.workspace_id, name=body.name.strip(), planned_minor=planned,
                      funded_minor=funded, currency=cur, target_date=body.target_date, notes=body.notes)
    db.add(p)
    db.flush()
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="future_project.created",
          entity="future_project", entity_id=p.id)
    db.commit()
    return _fp_out(p)


@router.patch("/future-projects/{pid}")
def patch_future(pid: str, body: FuturePatch, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    p = db.get(FutureProject, pid)
    if not p or p.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Future project not found")
    if body.name is not None:
        p.name = body.name.strip()
    if body.notes is not None:
        p.notes = body.notes
    if body.target_date is not None:
        p.target_date = body.target_date
    cur = (body.currency or p.currency).upper()
    if body.currency is not None:
        if cur not in CURRENCIES:
            raise HTTPException(422, "Unsupported currency")
        p.currency = cur
    if body.planned is not None:
        p.planned_minor, _ = parse_money(body.planned, p.currency)
    if body.funded is not None:
        p.funded_minor, _ = parse_money(body.funded, p.currency)
    db.commit()
    return _fp_out(p)


@router.delete("/future-projects/{pid}")
def delete_future(pid: str, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    p = db.get(FutureProject, pid)
    if not p or p.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Future project not found")
    db.delete(p)
    db.commit()
    return {"ok": True}
