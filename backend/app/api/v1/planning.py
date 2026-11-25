"""Budgets, reservations (AI spend guard), subscriptions, AI usage, savings goals."""
from __future__ import annotations

import datetime as dt
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.common import money_out, parse_money, today
from app.core.config import get_settings
from app.core.money import Money
from app.core.permissions import WorkspaceContext, current_user, owner_ws, read_ws, write_ws
from app.core.service_auth import ServiceAuthError, is_service_call, verify
from app.modules.currencies.service import Converter
from app.database.models import (AIUsageRecord, Budget, BudgetReservation, FinancialAccount, SavingsGoal, Subscription,
                                 TransactionCategory)
from app.database.session import get_db
from app.modules.audit.service import audit
from app.modules.budgets import service as budgets
from app.modules.events.service import emit
from app.modules.reports.service import budget_view
from app.modules.subscriptions import service as subs
from app.modules.transactions import service as txns

router = APIRouter(tags=["planning"])
AI_PROVIDERS = {"openai", "xai", "anthropic", "google", "other"}


# ---------- budgets ----------
class BudgetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: str = "category"
    category_id: str | None = None
    ai_provider: str | None = None
    amount: str
    currency: str
    alert_threshold_pct: int = Field(default=80, ge=1, le=100)
    hard_limit: bool = False


@router.get("/budgets")
def list_budgets(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db), month: str | None = None):
    on = date.fromisoformat(month + "-01") if month else today()
    return [budget_view(budgets.status(db, b, on))
            for b in db.scalars(select(Budget).where(Budget.workspace_id == ctx.workspace_id).order_by(Budget.created_at))]


@router.post("/budgets", status_code=201)
def create_budget(body: BudgetIn, ctx: WorkspaceContext = Depends(owner_ws), db: Session = Depends(get_db)):
    amount, cur = parse_money(body.amount, body.currency)
    if amount <= 0:
        raise HTTPException(422, "Budget must be greater than zero")
    if body.scope == "category":
        c = db.get(TransactionCategory, body.category_id) if body.category_id else None
        if not c or c.workspace_id != ctx.workspace_id or c.direction != "expense":
            raise HTTPException(422, "Choose an expense category for this budget")
    elif body.scope == "ai":
        if body.ai_provider and body.ai_provider not in AI_PROVIDERS:
            raise HTTPException(422, "Unknown AI provider")
    else:
        raise HTTPException(422, "scope must be category or ai")
    b = Budget(workspace_id=ctx.workspace_id, name=body.name.strip(), scope=body.scope,
               category_id=body.category_id if body.scope == "category" else None,
               ai_provider=body.ai_provider if body.scope == "ai" else None, currency=cur, allocated_minor=amount,
               alert_threshold_pct=body.alert_threshold_pct, hard_limit=body.hard_limit)
    db.add(b)
    db.flush()
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="budget.created", entity="budget", entity_id=b.id,
          detail={"allocated_minor": amount, "currency": cur})
    emit(db, workspace_id=ctx.workspace_id, event_type="budget.updated",
         data={"budget_id": b.id, "allocated": {"amount_minor": amount, "currency": cur}})
    db.commit()
    return budget_view(budgets.status(db, b, today()))


def _budget(db: Session, ctx: WorkspaceContext, bid: str) -> Budget:
    return _budget_ws(db, ctx.workspace_id, bid)


class BudgetPatch(BaseModel):
    amount: str | None = None
    alert_threshold_pct: int | None = Field(default=None, ge=1, le=100)
    hard_limit: bool | None = None
    name: str | None = Field(default=None, max_length=120)


@router.patch("/budgets/{bid}")
def patch_budget(bid: str, body: BudgetPatch, ctx: WorkspaceContext = Depends(owner_ws), db: Session = Depends(get_db)):
    b = _budget(db, ctx, bid)
    before = b.allocated_minor
    if body.amount is not None:
        amt, _ = parse_money(body.amount, b.currency)
        if amt <= 0:
            raise HTTPException(422, "Budget must be greater than zero")
        b.allocated_minor = amt
    for k in ("alert_threshold_pct", "hard_limit", "name"):
        v = getattr(body, k)
        if v is not None:
            setattr(b, k, v)
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="budget.updated", entity="budget", entity_id=b.id,
          detail={"allocated_before": before, "allocated_after": b.allocated_minor})
    db.commit()
    return budget_view(budgets.status(db, b, today()))


@router.delete("/budgets/{bid}")
def delete_budget(bid: str, ctx: WorkspaceContext = Depends(owner_ws), db: Session = Depends(get_db)):
    """Budgets are plans, not posted history, so they may be removed (audited)."""
    b = _budget(db, ctx, bid)
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="budget.deleted", entity="budget",
          entity_id=b.id, detail={"name": b.name})
    db.delete(b)
    db.commit()
    return {"ok": True}


# ---------- reservations ----------
# Two callers share these paths (contract: ecosystem-contracts/COORDINATION.md "Budget reservations"):
#  * the owner's browser session (cookie + X-Workspace-Id), body ReserveIn / SettleIn;
#  * RAGI, signed with its own rotating HMAC key (X-Arnova-Key-Id / -Timestamp / -Signature, scope budget:reserve),
#    body ServiceReserveIn = ecosystem-contracts/schemas/budget-reservation-request.schema.json (ONE schema),
#    always against OMH_RAGI_WORKSPACE_ID and always fail-closed (hard limit enforced).
class MoneyIn(BaseModel):
    amount: str = Field(max_length=32)
    currency: str = Field(min_length=3, max_length=3)


class ReserveIn(BaseModel):
    budget_id: str
    amount: str
    purpose: str = Field(min_length=1, max_length=255)
    agent_id: str | None = Field(default=None, max_length=60)
    external_ref: str | None = Field(default=None, max_length=120)


class ServiceReserveIn(BaseModel):
    """RAGI → OMH body: ecosystem-contracts/schemas/budget-reservation-request.schema.json."""

    model_config = ConfigDict(extra="forbid")
    agent_id: str = Field(min_length=1, max_length=60)
    run_id: str = Field(min_length=1, max_length=120)
    project_id: str | None = Field(default=None, max_length=120)
    provider: str = "other"
    estimated_cost: MoneyIn
    source: str = "ragi"


SERVICE_PROVIDERS = AI_PROVIDERS


class SettleIn(BaseModel):
    actual_cost: str | MoneyIn
    provider: str
    model: str | None = Field(default=None, max_length=80)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


def reservation_view(r: BudgetReservation) -> dict:
    return {"id": r.id, "reservation_id": r.id, "budget_id": r.budget_id, "purpose": r.purpose, "agent_id": r.agent_id,
            "external_ref": r.external_ref, "amount": money_out(r.amount_minor, r.currency), "status": r.status,
            "period": r.period_start.strftime("%Y-%m"), "created_at": r.created_at.isoformat(),
            "settled_usage_id": r.settled_usage_id}


class _Caller:
    def __init__(self, workspace_id: str, user_id: str | None, service: bool, service_name: str | None = None):
        self.workspace_id, self.user_id, self.service, self.service_name = workspace_id, user_id, service, service_name


def _caller(request: Request, db: Session, min_role: str, body: bytes = b"") -> _Caller:
    """A signed service call (X-Arnova-* headers) or a signed-in user. Never both, never a static bearer."""
    if is_service_call(request.headers):
        try:
            key = verify(request.headers, body, scope="budget:reserve")
        except ServiceAuthError as e:
            raise HTTPException(e.status, str(e)) from e
        if key.service != "ragi":
            raise HTTPException(403, "Only RAGI may reserve AI budget")
        ws = get_settings().omh_ragi_workspace_id
        if not ws:
            raise HTTPException(503, "OMH_RAGI_WORKSPACE_ID is not configured")
        return _Caller(ws, None, True, key.service)
    user = current_user(request, db)
    from app.core.permissions import WorkspaceAccess

    ctx = WorkspaceAccess(min_role)(request.headers.get("x-workspace-id"), request.query_params.get("ws"), user, db)
    return _Caller(ctx.workspace_id, user.id, False)


def _json(raw: bytes):
    import json

    try:
        return json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(422, "Body must be JSON") from e


def _service_body(raw, service: str) -> ServiceReserveIn:
    if not isinstance(raw, dict):
        raise HTTPException(422, "Body must be a JSON object")
    body = ServiceReserveIn.model_validate(raw)
    if body.source != service:
        raise HTTPException(403, "source does not match the signing key")
    return body


def _ai_budget_for(db: Session, ws: str, provider: str) -> Budget | None:
    rows = list(db.scalars(select(Budget).where(Budget.workspace_id == ws, Budget.scope == "ai")))
    return next((b for b in rows if b.ai_provider == provider), None) or next((b for b in rows if not b.ai_provider), None)


@router.get("/budget-reservations")
def list_reservations(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(BudgetReservation).join(Budget, Budget.id == BudgetReservation.budget_id)
                      .where(Budget.workspace_id == ctx.workspace_id).order_by(BudgetReservation.created_at.desc()).limit(200))
    return [reservation_view(r) for r in rows]


@router.post("/budget-reservations", status_code=201)
async def create_reservation(request: Request, db: Session = Depends(get_db)):
    raw_bytes = await request.body()
    c = _caller(request, db, "editor", raw_bytes)
    raw = _json(raw_bytes)
    try:
        if c.service:
            body = _service_body(raw, c.service_name)
            if body.provider not in SERVICE_PROVIDERS:
                raise HTTPException(422, "Unknown AI provider")
            b = _ai_budget_for(db, c.workspace_id, body.provider)
            if not b:
                raise HTTPException(409, "No AI budget is set up in OMH, so nothing can be reserved")
            est, cur = parse_money(body.estimated_cost.amount, body.estimated_cost.currency, "estimated_cost")
            if cur != b.currency:
                conv = Converter(db, b.currency, c.workspace_id)(Money(est, cur), today())
                if conv is None:
                    raise HTTPException(409, f"No current {cur}→{b.currency} rate; reservation refused")
                est = conv.minor
            r = budgets.reserve(db, b, amount_minor=est, purpose=f"{body.source} run {body.run_id}"[:255], agent_id=body.agent_id,
                                external_ref=body.run_id, on=today(), user_id=None, enforce=True)
        else:
            body = ReserveIn.model_validate(raw)
            b = _budget_ws(db, c.workspace_id, body.budget_id)
            amount, _ = parse_money(body.amount, b.currency)
            r = budgets.reserve(db, b, amount_minor=amount, purpose=body.purpose, agent_id=body.agent_id,
                                external_ref=body.external_ref, on=today(), user_id=c.user_id)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False)) from e
    except budgets.BudgetUnavailable as e:
        db.rollback()
        raise HTTPException(409, str(e)) from e
    except budgets.BudgetError as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    db.commit()
    st = budgets.status(db, b, today())
    return {**reservation_view(r), "available": money_out(st.available_minor, b.currency)}


def _budget_ws(db: Session, ws: str, bid: str) -> Budget:
    b = db.get(Budget, bid)
    if not b or b.workspace_id != ws:
        raise HTTPException(404, "Budget not found")
    return b


def _reservation(db: Session, ws: str, rid: str) -> tuple[BudgetReservation, Budget]:
    r = db.get(BudgetReservation, rid)
    b = db.get(Budget, r.budget_id) if r else None
    if not r or not b or b.workspace_id != ws:
        raise HTTPException(404, "Reservation not found")
    return r, b


@router.post("/budget-reservations/{rid}/settle")
async def settle_reservation(rid: str, request: Request, db: Session = Depends(get_db)):
    """Actual charges replace the reserved estimate (master spec §08)."""
    raw_bytes = await request.body()
    c = _caller(request, db, "editor", raw_bytes)
    try:
        body = SettleIn.model_validate(_json(raw_bytes))
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False)) from e
    r, b = _reservation(db, c.workspace_id, rid)
    if body.provider not in SERVICE_PROVIDERS:
        raise HTTPException(422, "Unknown AI provider")
    provider = body.provider
    if isinstance(body.actual_cost, MoneyIn):
        cost, cur = parse_money(body.actual_cost.amount, body.actual_cost.currency, "actual_cost")
    else:
        cost, cur = parse_money(body.actual_cost, b.currency, "actual_cost")
    if cost < 0:
        raise HTTPException(422, "Cost cannot be negative")
    if r.status != "active":
        raise HTTPException(409, f"Reservation is already {r.status}")
    u = AIUsageRecord(workspace_id=c.workspace_id, provider=provider, model=body.model, agent_id=r.agent_id,
                      input_tokens=body.input_tokens, output_tokens=body.output_tokens, cost_minor=cost,
                      currency=cur, occurred_on=today(), source="reservation", external_ref=r.id)
    db.add(u)
    db.flush()
    budgets.resolve(db, r, "settled", u.id, c.user_id)
    budgets.check_alerts(db, b, today())
    db.commit()
    return {"reservation": reservation_view(r), "usage_id": u.id,
            "budget": budget_view(budgets.status(db, b, today()))}


@router.post("/budget-reservations/{rid}/release")
async def release_reservation(rid: str, request: Request, db: Session = Depends(get_db)):
    c = _caller(request, db, "editor", await request.body())
    r, b = _reservation(db, c.workspace_id, rid)
    try:
        budgets.resolve(db, r, "released", None, c.user_id)
    except budgets.BudgetError as e:
        raise HTTPException(409, str(e)) from e
    db.commit()
    return {"reservation": reservation_view(r), "budget": budget_view(budgets.status(db, b, today()))}


# ---------- subscriptions ----------
class SubIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    vendor: str = Field(min_length=1, max_length=120)
    kind: str = "software"
    direction: str = "outgoing"
    amount: str
    currency: str
    interval: str = "monthly"
    next_renewal: date | None = None
    status: str = "active"
    account_id: str | None = None
    category_id: str | None = None
    project: str | None = Field(default=None, max_length=120)
    agent_id: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)


class SubPatch(BaseModel):
    status: str | None = None
    next_renewal: date | None = None
    account_id: str | None = None
    amount: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


def sub_view(s: Subscription, dup_ids: set[str]) -> dict:
    return {"id": s.id, "name": s.name, "vendor": s.vendor, "kind": s.kind, "direction": s.direction,
            "amount": money_out(s.amount_minor, s.currency), "interval": s.interval,
            "monthly": money_out(subs.monthly(s).minor, s.currency),
            "next_renewal": s.next_renewal.isoformat() if s.next_renewal else None, "status": s.status,
            "account_id": s.account_id, "category_id": s.category_id, "project": s.project, "agent_id": s.agent_id,
            "notes": s.notes, "possible_duplicate": s.id in dup_ids}


def _validate_sub(db: Session, ctx: WorkspaceContext, kind, direction, interval, status, account_id, category_id, cur):
    if kind not in subs.KINDS:
        raise HTTPException(422, "Unknown subscription kind")
    if direction not in {"outgoing", "incoming"}:
        raise HTTPException(422, "direction must be outgoing or incoming")
    if interval not in subs.INTERVALS:
        raise HTTPException(422, "Unknown interval")
    if status not in {"active", "trial", "paused", "cancelled"}:
        raise HTTPException(422, "Unknown status")
    if account_id:
        a = db.get(FinancialAccount, account_id)
        if not a or a.workspace_id != ctx.workspace_id:
            raise HTTPException(422, "Account not found")
        if a.currency != cur:
            raise HTTPException(422, f"{a.name} holds {a.currency}; subscription is billed in {cur}")
    if category_id:
        c = db.get(TransactionCategory, category_id)
        want = "income" if direction == "incoming" else "expense"
        if not c or c.workspace_id != ctx.workspace_id or c.direction != want:
            raise HTTPException(422, f"Choose an {want} category")


@router.get("/subscriptions")
def list_subscriptions(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Subscription).where(Subscription.workspace_id == ctx.workspace_id)
                           .order_by(Subscription.next_renewal.is_(None), Subscription.next_renewal)))
    dups = {i for g in subs.duplicates(rows) for i in g}
    return [sub_view(s, dups) for s in rows]


@router.post("/subscriptions", status_code=201)
def create_subscription(body: SubIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    amount, cur = parse_money(body.amount, body.currency)
    if amount <= 0:
        raise HTTPException(422, "Amount must be greater than zero")
    _validate_sub(db, ctx, body.kind, body.direction, body.interval, body.status, body.account_id, body.category_id, cur)
    s = Subscription(workspace_id=ctx.workspace_id, name=body.name.strip(), vendor=body.vendor.strip(), kind=body.kind,
                     direction=body.direction, amount_minor=amount, currency=cur, interval=body.interval,
                     next_renewal=body.next_renewal, anchor_day=body.next_renewal.day if body.next_renewal else None,
                     status=body.status, account_id=body.account_id,
                     category_id=body.category_id, project=body.project, agent_id=body.agent_id, notes=body.notes)
    db.add(s)
    db.flush()
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="subscription.created", entity="subscription",
          entity_id=s.id, detail={"amount_minor": amount, "currency": cur, "interval": body.interval})
    emit(db, workspace_id=ctx.workspace_id, event_type="subscription.updated",
         data={"subscription_id": s.id, "status": s.status, "kind": s.kind})
    db.commit()
    rows = list(db.scalars(select(Subscription).where(Subscription.workspace_id == ctx.workspace_id)))
    return sub_view(s, {i for g in subs.duplicates(rows) for i in g})


def _sub(db: Session, ctx: WorkspaceContext, sid: str) -> Subscription:
    s = db.get(Subscription, sid)
    if not s or s.workspace_id != ctx.workspace_id:
        raise HTTPException(404, "Subscription not found")
    return s


@router.patch("/subscriptions/{sid}")
def patch_subscription(sid: str, body: SubPatch, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    s = _sub(db, ctx, sid)
    ch = body.model_dump(exclude_unset=True)
    if "amount" in ch:
        amt, _ = parse_money(ch.pop("amount"), s.currency)
        if amt <= 0:
            raise HTTPException(422, "Amount must be greater than zero")
        ch["amount_minor"] = amt
    _validate_sub(db, ctx, s.kind, s.direction, s.interval, ch.get("status", s.status), ch.get("account_id"), None,
                  s.currency)
    for k, v in ch.items():
        setattr(s, k, v)
    if ch.get("next_renewal"):
        s.anchor_day = ch["next_renewal"].day
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="subscription.updated", entity="subscription",
          entity_id=s.id, detail={k: str(v) for k, v in ch.items()})
    emit(db, workspace_id=ctx.workspace_id, event_type="subscription.updated",
         data={"subscription_id": s.id, "status": s.status})
    db.commit()
    return sub_view(s, set())


class PayIn(BaseModel):
    date: dt.date | None = None
    renewal: dt.date | None = None  # the renewal being paid (idempotency)


@router.post("/subscriptions/{sid}/record-payment", status_code=201)
def pay_subscription(sid: str, body: PayIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    s = _sub(db, ctx, sid)
    try:
        t = subs.record_payment(db, s, on=body.date, today=today(), user_id=ctx.user.id,
                                renewal=body.renewal)
    except subs.AlreadyPaid as e:
        raise HTTPException(409, str(e)) from e
    except txns.TxnError as e:
        raise HTTPException(422, str(e)) from e
    db.commit()
    return {"transaction_id": t.id, "subscription": sub_view(s, set())}


# ---------- AI usage ----------
class UsageIn(BaseModel):
    provider: str
    model: str | None = Field(default=None, max_length=80)
    agent_id: str | None = Field(default=None, max_length=60)
    project: str | None = Field(default=None, max_length=120)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cost: str
    currency: str
    date: dt.date
    external_ref: str | None = Field(default=None, max_length=120)


def usage_view(u: AIUsageRecord) -> dict:
    return {"id": u.id, "provider": u.provider, "model": u.model, "agent_id": u.agent_id, "project": u.project,
            "input_tokens": u.input_tokens, "output_tokens": u.output_tokens, "cost": money_out(u.cost_minor, u.currency),
            "date": u.occurred_on.isoformat(), "source": u.source}


@router.get("/ai-usage")
def list_usage(ctx: WorkspaceContext = Depends(read_ws), db: Session = Depends(get_db)):
    rows = db.scalars(select(AIUsageRecord).where(AIUsageRecord.workspace_id == ctx.workspace_id)
                      .order_by(AIUsageRecord.occurred_on.desc(), AIUsageRecord.created_at.desc()).limit(500))
    return [usage_view(u) for u in rows]


@router.post("/ai-usage", status_code=201)
def add_usage(body: UsageIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    if body.provider not in AI_PROVIDERS:
        raise HTTPException(422, "Unknown AI provider")
    cost, cur = parse_money(body.cost, body.currency, "cost")
    if cost < 0:
        raise HTTPException(422, "Cost cannot be negative")
    if body.external_ref and db.scalar(select(AIUsageRecord.id).where(
            AIUsageRecord.workspace_id == ctx.workspace_id, AIUsageRecord.source == "manual",
            AIUsageRecord.external_ref == body.external_ref)):
        raise HTTPException(409, "This usage record was already entered")
    u = AIUsageRecord(workspace_id=ctx.workspace_id, provider=body.provider, model=body.model, agent_id=body.agent_id,
                      project=body.project, input_tokens=body.input_tokens, output_tokens=body.output_tokens,
                      cost_minor=cost, currency=cur, occurred_on=body.date, source="manual", external_ref=body.external_ref)
    db.add(u)
    db.flush()
    audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user.id, action="ai_usage.recorded", entity="ai_usage",
          entity_id=u.id, detail={"cost_minor": cost, "currency": cur, "provider": body.provider})
    for b in db.scalars(select(Budget).where(Budget.workspace_id == ctx.workspace_id, Budget.scope == "ai")):
        if not b.ai_provider or b.ai_provider == body.provider:
            budgets.check_alerts(db, b, body.date)
    db.commit()
    return usage_view(u)


# ---------- savings goals ----------
class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target: str
    currency: str
    account_id: str | None = None
    target_date: date | None = None


@router.post("/savings-goals", status_code=201)
def add_goal(body: GoalIn, ctx: WorkspaceContext = Depends(write_ws), db: Session = Depends(get_db)):
    amt, cur = parse_money(body.target, body.currency, "target")
    if amt <= 0:
        raise HTTPException(422, "Target must be greater than zero")
    if body.account_id:
        a = db.get(FinancialAccount, body.account_id)
        if not a or a.workspace_id != ctx.workspace_id:
            raise HTTPException(422, "Account not found")
    g = SavingsGoal(workspace_id=ctx.workspace_id, name=body.name.strip(), target_minor=amt, currency=cur,
                    account_id=body.account_id, target_date=body.target_date)
    db.add(g)
    db.commit()
    return {"id": g.id}
