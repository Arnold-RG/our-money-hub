"""Budgets: Available budget = Allocated − Actual spending − Active reservations (master spec §16)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.dates import month_end, month_start
from app.core.money import Money
from app.database.models import AIUsageRecord, Budget, BudgetReservation
from app.modules.audit.service import audit
from app.modules.currencies.service import Converter
from app.modules.events.service import emit
from app.modules.reports.flows import compute_flows


class BudgetError(ValueError):
    pass


class BudgetUnavailable(BudgetError):
    pass


@dataclass
class BudgetStatus:
    budget: Budget
    period_start: date
    period_end: date
    actual_minor: int
    reserved_minor: int
    unconverted: dict[str, int]

    @property
    def available_minor(self) -> int:
        return self.budget.allocated_minor - self.actual_minor - self.reserved_minor

    @property
    def utilization(self) -> Decimal:
        """Actual spending ÷ allocated budget, as a fraction (4 dp)."""
        return (Decimal(self.actual_minor) / Decimal(self.budget.allocated_minor)).quantize(Decimal("0.0001"))

    @property
    def committed_utilization(self) -> Decimal:
        return (Decimal(self.actual_minor + self.reserved_minor) / Decimal(self.budget.allocated_minor)).quantize(
            Decimal("0.0001"))

    @property
    def state(self) -> str:
        pct = self.committed_utilization * 100
        if self.actual_minor > self.budget.allocated_minor:
            return "exceeded"
        if pct >= self.budget.alert_threshold_pct:
            return "warning"
        return "on_track"


def ai_actual(db: Session, b: Budget, start: date, end: date, conv: Converter) -> tuple[int, dict[str, int]]:
    q = select(AIUsageRecord).where(AIUsageRecord.workspace_id == b.workspace_id,
                                    AIUsageRecord.occurred_on >= start, AIUsageRecord.occurred_on <= end)
    if b.ai_provider:
        q = q.where(AIUsageRecord.provider == b.ai_provider)
    total, missing = 0, {}
    for u in db.scalars(q):
        m = conv(Money(u.cost_minor, u.currency), u.occurred_on)
        if m is None:
            missing[u.currency] = missing.get(u.currency, 0) + 1
        else:
            total += m.minor
    return total, missing


def status(db: Session, b: Budget, on: date) -> BudgetStatus:
    start, end = month_start(on), month_end(on)
    conv = Converter(db, b.currency)
    if b.scope == "ai":
        actual, missing = ai_actual(db, b, start, end, conv)
    else:
        f = compute_flows(db, b.workspace_id, start, end, conv, category_id=b.category_id)
        actual, missing = f.expense, dict(f.unconverted)
    reserved = int(db.scalar(select(func.coalesce(func.sum(BudgetReservation.amount_minor), 0)).where(
        BudgetReservation.budget_id == b.id, BudgetReservation.status == "active",
        BudgetReservation.period_start == start)) or 0)
    return BudgetStatus(b, start, end, actual, reserved, missing)


def check_alerts(db: Session, b: Budget, on: date) -> BudgetStatus:
    st = status(db, b, on)
    period = st.period_start.strftime("%Y-%m")
    if st.state == "exceeded":
        emit(db, workspace_id=b.workspace_id, event_type="budget.exceeded",
             data={"budget_id": b.id, "name": b.name, "period": period,
                   "allocated": {"amount_minor": b.allocated_minor, "currency": b.currency},
                   "actual": {"amount_minor": st.actual_minor, "currency": b.currency}},
             dedupe_key=f"budget.exceeded:{b.id}:{period}")
    return st


def reserve(db: Session, b: Budget, *, amount_minor: int, purpose: str, agent_id: str | None,
            external_ref: str | None, on: date, user_id: str | None) -> BudgetReservation:
    if amount_minor <= 0:
        raise BudgetError("Reservation must be greater than zero")
    st = status(db, b, on)
    if b.hard_limit and amount_minor > st.available_minor:
        raise BudgetUnavailable(
            f"Only {Money(max(st.available_minor, 0), b.currency)} available in '{b.name}' this month")
    r = BudgetReservation(budget_id=b.id, purpose=purpose[:255], agent_id=agent_id, external_ref=external_ref,
                          amount_minor=amount_minor, currency=b.currency, period_start=st.period_start)
    db.add(r)
    db.flush()
    audit(db, workspace_id=b.workspace_id, user_id=user_id, action="reservation.created", entity="budget_reservation",
          entity_id=r.id, detail={"amount_minor": amount_minor, "currency": b.currency, "agent_id": agent_id})
    emit(db, workspace_id=b.workspace_id, event_type="budget.updated",
         data={"budget_id": b.id, "reservation_id": r.id, "available_minor": st.available_minor - amount_minor,
               "currency": b.currency})
    return r


def resolve(db: Session, r: BudgetReservation, new_status: str, usage_id: str | None, user_id: str | None) -> None:
    if r.status != "active":
        raise BudgetError(f"Reservation is already {r.status}")
    r.status = new_status
    r.settled_usage_id = usage_id
    r.resolved_at = datetime.now(UTC)
    b = db.get(Budget, r.budget_id)
    audit(db, workspace_id=b.workspace_id, user_id=user_id, action=f"reservation.{new_status}",
          entity="budget_reservation", entity_id=r.id, detail={"usage_id": usage_id})
