"""Reports, exchange rates, global search, audit log, events (outbox + signed inbox)."""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.common import today
from app.core.dates import parse_month
from app.core.money import CURRENCIES, CURRENCY_NAMES, MoneyError, normalize_currency, parse_amount
from app.core.config import get_settings
from app.core.permissions import WorkspaceContext, read_ws, write_ws
from app.core.service_auth import ServiceAuthError, verify
from app.database.models import (AIUsageRecord, AuditLog, Budget, EventInbox, EventOutbox, FinancialAccount,
                                 Subscription, Transaction, User)
from app.database.session import get_db
from app.modules.currencies import service as fx
from app.modules.audit.service import audit
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
    return {"id": r.id, "base": r.base, "quote": r.quote, "rate": format(Decimal(r.rate).normalize(), "f"),
            "effective_date": r.effective_date.isoformat(), "source": r.source, "provider": r.provider, "via": r.via,
            "rate_type": r.rate_type, "source_url": r.source_url, "fetched_at": r.fetched_at.isoformat()}


@router.get("/currencies")
def currencies():
    return [{"code": c, "name": CURRENCY_NAMES[c], "minor_units": e} for c, e in CURRENCIES.items()]


@router.get("/exchange-rates")
def list_rates(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    return [rate_view(r) for r in fx.latest_rates(db, ctx.workspace_id)]


@router.get("/exchange-rates/quote")
def quote(base: str, quote: str, on: date | None = None, ctx: WorkspaceContext = Depends(read_ws),
          db: Session = Depends(get_db)):
    q = fx.get_rate(db, base, quote, on or today(), ctx.workspace_id)
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
def add_rate(body: RateIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    """Manual rates apply to THIS workspace only; official rates stay read-only."""
    try:
        txt = body.rate.strip().replace(",", ".")
        if not txt.replace(".", "", 1).isascii() or not txt.replace(".", "", 1).isdigit():
            raise ValueError("use digits and one decimal point")
        rate = Decimal(txt)
        r = fx.add_manual(db, ctx.workspace_id, body.base, body.quote, rate, body.effective_date, body.note)
    except (InvalidOperation, ValueError, MoneyError) as e:
        raise HTTPException(422, f"Invalid rate: {e}") from e
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="exchange_rate.added", entity="exchange_rate",
          entity_id=r.id, detail={"pair": f"{r.base}/{r.quote}", "rate": str(rate)})
    db.commit()
    return rate_view(r)


_last_sync = {"at": 0.0}
SYNC_COOLDOWN_S = 600


@router.post("/exchange-rates/sync")
def sync_rates(ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    """Fetch official rates now: NBP (A: EUR/USD, B: RWF), ECB and BNR (relayed by Frankfurter).

    Editors of a real (non-demo) workspace only, with a global cooldown so nobody can drive outbound traffic.
    """
    import time

    if ctx.user.is_demo:
        raise HTTPException(403, "Not available in the demo")
    if time.time() - _last_sync["at"] < SYNC_COOLDOWN_S:
        return {"stored": [rate_view(r) for r in fx.latest_rates(db, None)], "errors": {}, "cached": True}
    _last_sync["at"] = time.time()
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
             "occurred_at": e.occurred_at.isoformat(), "published": e.published_at is not None, "data": e.payload.get("data"),
             "envelope": e.payload}
            for e in rows]


class EventEnvelope(BaseModel):
    """Master spec §10 envelope (ecosystem-contracts/schemas/event.schema.json)."""

    model_config = ConfigDict(extra="forbid")
    schema_version: str = Field(pattern=r"^1\.0$")
    event_id: str = Field(min_length=8, max_length=64)
    event_type: str = Field(pattern=r"^[a-z]+(\.[a-z_]+)+$", max_length=80)
    source: str
    organization_id: str = Field(max_length=80)
    project_id: str | None = Field(default=None, max_length=120)
    occurred_at: datetime
    data: dict


EVENT_SOURCES = {"ragi", "omh", "github", "monitoring", "arnovagroup", "movies"}


@router.post("/events", status_code=202)
async def receive_event(request: Request, db: Session = Depends(get_db)):
    """Signed inbox (ecosystem-contracts/docs/authentication.md §2, §4). Scope ``events:write``;
    the envelope ``source`` must equal the signing key's service. Duplicates (same event_id, or the same
    usage record under a new event_id) are acknowledged and ignored. Only ``agent.usage.recorded`` is applied.
    """
    body = await request.body()
    try:
        key = verify(request.headers, body, scope="events:write")
    except ServiceAuthError as e:
        raise HTTPException(e.status, str(e)) from e
    try:
        ev = EventEnvelope.model_validate_json(body)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False)) from e
    if ev.source not in EVENT_SOURCES:
        raise HTTPException(422, "Unknown event source")
    if ev.source != key.service:
        raise HTTPException(403, "Envelope source does not match the signing key")
    if db.get(EventInbox, ev.event_id):
        return {"status": "duplicate", "event_id": ev.event_id}
    payload = json.loads(body)
    row = EventInbox(event_id=ev.event_id, event_type=ev.event_type, source=ev.source, payload=payload)
    db.add(row)
    ws = get_settings().omh_ragi_workspace_id
    if ev.event_type == "agent.usage.recorded" and ws and ev.source == "ragi":
        d = ev.data
        cost = d.get("cost") or {}
        try:
            cur = normalize_currency(cost["currency"])
            minor = parse_amount(str(cost["amount"]), cur)
            if minor < 0:
                raise ValueError("negative cost")
            db.add(AIUsageRecord(workspace_id=ws, provider=str(d.get("provider", "other"))[:40],
                                 model=d.get("model"), agent_id=d.get("agent_id"), project=ev.project_id,
                                 input_tokens=int(d.get("input_tokens", 0)), output_tokens=int(d.get("output_tokens", 0)),
                                 cost_minor=minor, currency=cur, occurred_on=ev.occurred_at.date(), source="ragi",
                                 external_ref=str(d.get("usage_record_id") or ev.event_id)[:120]))
            row.processed, row.result = True, "ai_usage_recorded"
        except (KeyError, ValueError, TypeError, MoneyError) as e:
            row.result = f"not applied: {e}"[:255]
    else:
        row.result = "stored"
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # The usage record already exists under another event_id: remember the event, do not double count.
        db.add(EventInbox(event_id=ev.event_id, event_type=ev.event_type, source=ev.source, payload=payload,
                          processed=False, result="duplicate usage record"))
        db.commit()
        return {"status": "duplicate", "event_id": ev.event_id}
    return {"status": "accepted", "event_id": ev.event_id, "result": row.result}


@router.get("/finance-summary")
def finance_summary(request: Request, organization_id: str, db: Session = Depends(get_db)):
    """Read-only summary for RAGI's dashboard (scope ``finance:read``, signed GET with an empty body).

    Per currency, never summed across currencies, so no exchange rate is needed and nothing is invented.
    """
    try:
        verify(request.headers, b"", scope="finance:read")
    except ServiceAuthError as e:
        raise HTTPException(e.status, str(e)) from e
    s = get_settings()
    if not s.omh_ragi_workspace_id:
        raise HTTPException(503, "OMH_RAGI_WORKSPACE_ID is not configured")
    if organization_id != s.omh_ragi_organization_id:
        raise HTTPException(404, "Unknown organization_id")
    return reports.service_summary(db, s.omh_ragi_workspace_id, today())


