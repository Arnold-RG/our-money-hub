"""Reports, exchange rates, global search, audit log, events (outbox + signed inbox)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.v1.common import today
from app.core.dates import parse_month
from app.core.money import CURRENCIES, CURRENCY_NAMES, MoneyError, normalize_currency, parse_amount
from app.core.permissions import WorkspaceContext, current_user, read_ws, write_ws
from app.database.models import (AIUsageRecord, AuditLog, Budget, EventInbox, EventOutbox, FinancialAccount,
                                 Subscription, Transaction, User)
from app.database.session import get_db
from app.modules.currencies import service as fx
from app.modules.reports import service as reports

router = APIRouter(tags=["insight"])


def _cur(currency: str | None, user: User) -> str:
    try:
        return normalize_currency(currency or user.reporting_currency)
    except MoneyError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/reports/summary")
def report_summary(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db),
                   currency: str | None = None, month: str | None = None):
    t = today()
    return reports.summary(db, ctx.workspace_id, _cur(currency, ctx.user), parse_month(month, t), t)


@router.get("/reports/cashflow")
def report_cashflow(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db),
                    currency: str | None = None, months: int = Query(6, ge=1, le=36)):
    return reports.cashflow(db, ctx.workspace_id, _cur(currency, ctx.user), months, today())


@router.get("/reports/categories")
def report_categories(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db),
                      currency: str | None = None, month: str | None = None):
    return reports.categories(db, ctx.workspace_id, _cur(currency, ctx.user), parse_month(month, today()))


@router.get("/reports/forecast")
def report_forecast(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db),
                    currency: str | None = None, days: int = Query(90, ge=7, le=365)):
    return reports.forecast(db, ctx.workspace_id, _cur(currency, ctx.user), today(), days)


@router.get("/reports/signals")
def report_signals(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db), currency: str | None = None):
    return reports.signals(db, ctx.workspace_id, _cur(currency, ctx.user), today())


@router.get("/reports/retirement-limits")
def report_limits(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    return reports.retirement_limits(db, ctx.workspace_id, today())


# ---------- exchange rates (global reference data) ----------
def rate_view(r) -> dict:
    return {"id": r.id, "base": r.base, "quote": r.quote, "rate": str(Decimal(r.rate).normalize()),
            "effective_date": r.effective_date.isoformat(), "source": r.source, "provider": r.provider, "via": r.via,
            "rate_type": r.rate_type, "source_url": r.source_url, "fetched_at": r.fetched_at.isoformat()}


@router.get("/currencies")
def currencies():
    return [{"code": c, "name": CURRENCY_NAMES[c], "minor_units": e} for c, e in CURRENCIES.items()]


@router.get("/exchange-rates")
def list_rates(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [rate_view(r) for r in fx.latest_rates(db)]


@router.get("/exchange-rates/quote")
def quote(base: str, quote: str, on: date | None = None, user: User = Depends(current_user),
          db: Session = Depends(get_db)):
    q = fx.get_rate(db, base, quote, on or today())
    if not q:
        raise HTTPException(404, f"No {base}→{quote} rate on file")
    return {"base": base.upper(), "quote": quote.upper(), "rate": str(q.rate.quantize(Decimal("0.0000000001"))),
            "effective_date": q.effective_date.isoformat() if q.effective_date else None, "source": q.source}


class RateIn(BaseModel):
    base: str
    quote: str
    rate: str
    effective_date: date
    note: str | None = Field(default=None, max_length=80)


@router.post("/exchange-rates", status_code=201)
def add_rate(body: RateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        rate = Decimal(body.rate.replace(",", "."))
        r = fx.add_manual(db, body.base, body.quote, rate, body.effective_date, body.note)
    except (InvalidOperation, ValueError, MoneyError) as e:
        raise HTTPException(422, f"Invalid rate: {e}") from e
    db.commit()
    return rate_view(r)


@router.post("/exchange-rates/sync")
def sync_rates(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Fetch official rates now: NBP (A: EUR/USD, B: RWF), ECB and BNR (relayed by Frankfurter)."""
    res = fx.sync_all(db)
    db.commit()
    return {"stored": [rate_view(r) for r in res["stored"]], "errors": res["errors"]}


# ---------- search ----------
@router.get("/search")
def search(q: str = Query(min_length=1, max_length=80), ctx: WorkspaceContext = Depends(read_ws),
           db: Session = Depends(get_db)):
    like = f"%{q.lower()}%"
    ws = ctx.workspace_id
    out = []
    for a in db.scalars(select(FinancialAccount).where(FinancialAccount.workspace_id == ws,
                                                       func.lower(FinancialAccount.name).like(like)).limit(5)):
        out.append({"type": "account", "id": a.id, "title": a.name, "subtitle": f"{a.kind} · {a.currency}",
                    "href": "/accounts"})
    for s in db.scalars(select(Subscription).where(Subscription.workspace_id == ws, or_(
            func.lower(Subscription.name).like(like), func.lower(Subscription.vendor).like(like))).limit(5)):
        out.append({"type": "subscription", "id": s.id, "title": s.name, "subtitle": f"{s.vendor} · {s.interval}",
                    "href": "/subscriptions"})
    for b in db.scalars(select(Budget).where(Budget.workspace_id == ws, func.lower(Budget.name).like(like)).limit(5)):
        out.append({"type": "budget", "id": b.id, "title": b.name, "subtitle": "Budget", "href": "/budgets"})
    for t in db.scalars(select(Transaction).where(Transaction.workspace_id == ws, or_(
            func.lower(Transaction.description).like(like), func.lower(Transaction.payee).like(like)))
            .order_by(Transaction.txn_date.desc()).limit(8)):
        out.append({"type": "transaction", "id": t.id, "title": t.description,
                    "subtitle": f"{t.txn_date.isoformat()} · {t.kind}", "href": f"/transactions?q={q}"})
    return out


# ---------- audit + events ----------
@router.get("/audit-logs")
def audit_logs(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db), limit: int = Query(100, le=500)):
    rows = db.scalars(select(AuditLog).where(AuditLog.workspace_id == ctx.workspace_id)
                      .order_by(AuditLog.at.desc()).limit(limit))
    return [{"id": r.id, "action": r.action, "entity": r.entity, "entity_id": r.entity_id, "detail": r.detail,
             "at": r.at.isoformat()} for r in rows]


@router.get("/events/outbox")
def outbox(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(EventOutbox).where(EventOutbox.workspace_id == ctx.workspace_id)
                      .order_by(EventOutbox.occurred_at.desc()).limit(100))
    return [{"event_id": e.id, "event_type": e.event_type, "schema_version": e.schema_version,
             "occurred_at": e.occurred_at.isoformat(), "published": e.published_at is not None, "data": e.payload["data"]}
            for e in rows]


@router.post("/events", status_code=202)
async def receive_event(request: Request, db: Session = Depends(get_db)):
    """Signed inbox for RAGI → OMH events (ecosystem-contracts/COORDINATION.md).

    Header ``X-Arnova-Signature: sha256=<hex>`` = HMAC-SHA256(ECOSYSTEM_EVENT_SECRET, raw body).
    Only ``agent.usage.recorded`` is applied (as an AI usage record) and only when OMH_RAGI_WORKSPACE_ID is set.
    """
    secret = os.environ.get("ECOSYSTEM_EVENT_SECRET")
    if not secret:
        raise HTTPException(503, "Event inbox is not configured")
    body = await request.body()
    sig = request.headers.get("x-arnova-signature", "")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "Bad signature")
    try:
        ev = json.loads(body)
        event_id, event_type = str(ev["event_id"]), str(ev["event_type"])
    except (ValueError, KeyError) as e:
        raise HTTPException(422, "Malformed event") from e
    if ev.get("schema_version") != "1.0":
        raise HTTPException(422, "Unsupported schema_version")
    if db.get(EventInbox, event_id):
        return {"status": "duplicate", "event_id": event_id}
    row = EventInbox(event_id=event_id, event_type=event_type, source=str(ev.get("source", "?"))[:40], payload=ev)
    db.add(row)
    ws = os.environ.get("OMH_RAGI_WORKSPACE_ID")
    if event_type == "agent.usage.recorded" and ws:
        d = ev.get("data", {})
        cost = d.get("cost") or {}
        try:
            cur = normalize_currency(cost["currency"])
            minor = parse_amount(str(cost["amount"]), cur)
            db.add(AIUsageRecord(workspace_id=ws, provider=str(d.get("provider", "other"))[:40],
                                 model=d.get("model"), agent_id=d.get("agent_id"), project=ev.get("project_id"),
                                 input_tokens=int(d.get("input_tokens", 0)), output_tokens=int(d.get("output_tokens", 0)),
                                 cost_minor=minor, currency=cur,
                                 occurred_on=date.fromisoformat(str(ev["occurred_at"])[:10]), source="ragi",
                                 external_ref=str(d.get("usage_record_id") or event_id)[:120]))
            row.processed, row.result = True, "ai_usage_recorded"
        except (KeyError, ValueError, MoneyError) as e:
            row.result = f"not applied: {e}"[:255]
    else:
        row.result = "stored"
    db.commit()
    return {"status": "accepted", "event_id": event_id, "result": row.result}
