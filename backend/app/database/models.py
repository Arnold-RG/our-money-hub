"""OMH v2 data model. All money columns are integer minor units (BigInteger)."""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    reporting_currency: Mapped[str] = mapped_column(String(3), default="PLN")
    memberships: Mapped[list[WorkspaceMember]] = relationship(back_populates="user")


class FinancialWorkspace(TimestampMixin, Base):
    """Logically isolated books: personal vs. business (Arnova Group) etc."""

    __tablename__ = "financial_workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))  # personal | business | project
    base_currency: Mapped[str] = mapped_column(String(3), default="PLN")
    members: Mapped[list[WorkspaceMember]] = relationship(back_populates="workspace")
    __table_args__ = (CheckConstraint("kind in ('personal','business','project')", name="ck_ws_kind"),)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default="owner")  # owner | editor | viewer
    workspace: Mapped[FinancialWorkspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class ExchangeRate(Base):
    """rate = units of quote per 1 unit of base, effective at ``effective_date``."""

    __tablename__ = "exchange_rates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    base: Mapped[str] = mapped_column(String(3))
    quote: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(Numeric(24, 10))
    effective_date: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(120))  # e.g. "NBP table A 228/A/NBP/2026" or "manual"
    provider: Mapped[str] = mapped_column(String(20), default="manual")  # nbp | ecb | bnr | manual
    via: Mapped[str | None] = mapped_column(String(40), nullable=True)  # e.g. "frankfurter.dev" when relayed
    rate_type: Mapped[str] = mapped_column(String(4), default="mid")  # mid | bid | ask (only mid converts)
    source_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=5)  # lower wins on the same effective date
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        UniqueConstraint("base", "quote", "effective_date", "source", "rate_type", name="uq_rate"),
        Index("ix_rate_lookup", "base", "quote", "effective_date"),
    )


class FinancialAccount(TimestampMixin, Base):
    __tablename__ = "financial_accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # bank | cash | card | savings | credit | investment | mobile_money (MTN MoMo, Airtel Money)
    # | ikimina (group savings / tontine / VSLA) | ejo_heza | ppk | ike | ikze
    kind: Mapped[str] = mapped_column(String(20))
    currency: Mapped[str] = mapped_column(String(3))
    institution: Mapped[str | None] = mapped_column(String(120), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    ledger_account_id: Mapped[str] = mapped_column(ForeignKey("ledger_accounts.id"))


class LedgerAccount(Base):
    __tablename__ = "ledger_accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(12))  # asset | liability | equity | income | expense
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    __table_args__ = (UniqueConstraint("workspace_id", "code", name="uq_ledger_code"),)


class TransactionCategory(Base):
    __tablename__ = "transaction_categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    direction: Mapped[str] = mapped_column(String(10))  # income | expense
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    bucket: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 50/30/20 overlay: needs | wants | savings
    ledger_account_id: Mapped[str] = mapped_column(ForeignKey("ledger_accounts.id"))
    __table_args__ = (UniqueConstraint("workspace_id", "name", "direction", name="uq_category"),)


class JournalEntry(TimestampMixin, Base):
    __tablename__ = "journal_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[date] = mapped_column(Date)
    memo: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(12))  # confirmed | pending
    reverses_entry_id: Mapped[str | None] = mapped_column(ForeignKey("journal_entries.id"), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    lines: Mapped[list[JournalEntryLine]] = relationship(back_populates="entry", cascade="all, delete-orphan")


class JournalEntryLine(Base):
    __tablename__ = "journal_entry_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    entry_id: Mapped[str] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), index=True)
    ledger_account_id: Mapped[str] = mapped_column(ForeignKey("ledger_accounts.id"), index=True)
    currency: Mapped[str] = mapped_column(String(3))
    debit_minor: Mapped[int] = mapped_column(BigInteger, default=0)
    credit_minor: Mapped[int] = mapped_column(BigInteger, default=0)
    entry: Mapped[JournalEntry] = relationship(back_populates="lines")
    __table_args__ = (
        CheckConstraint("debit_minor >= 0 AND credit_minor >= 0", name="ck_line_nonneg"),
        CheckConstraint("(debit_minor = 0) OR (credit_minor = 0)", name="ck_line_one_side"),
    )


class Transaction(TimestampMixin, Base):
    """User-facing record. Every confirmed/pending transaction owns one balanced journal entry."""

    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # income | expense | transfer | opening | reversal
    status: Mapped[str] = mapped_column(String(12))  # confirmed | pending
    txn_date: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(String(255))
    payee: Mapped[str | None] = mapped_column(String(160), nullable=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)  # always positive, in currency
    currency: Mapped[str] = mapped_column(String(3))
    account_id: Mapped[str] = mapped_column(ForeignKey("financial_accounts.id"), index=True)
    to_account_id: Mapped[str | None] = mapped_column(ForeignKey("financial_accounts.id"), nullable=True)
    to_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # cross-currency transfers
    category_id: Mapped[str | None] = mapped_column(ForeignKey("transaction_categories.id"), nullable=True)
    subscription_id: Mapped[str | None] = mapped_column(ForeignKey("subscriptions.id"), nullable=True)
    project: Mapped[str | None] = mapped_column(String(120), nullable=True)
    journal_entry_id: Mapped[str] = mapped_column(ForeignKey("journal_entries.id"))
    reversal_of_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id"), nullable=True)
    reversed_by_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id"), nullable=True)
    import_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | csv | subscription | ai_usage
    __table_args__ = (CheckConstraint("amount_minor > 0", name="ck_txn_positive"),)


class Budget(TimestampMixin, Base):
    __tablename__ = "budgets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(String(12), default="category")  # category | ai
    category_id: Mapped[str | None] = mapped_column(ForeignKey("transaction_categories.id"), nullable=True)
    ai_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)  # for scope=ai, null = all providers
    currency: Mapped[str] = mapped_column(String(3))
    allocated_minor: Mapped[int] = mapped_column(BigInteger)
    period: Mapped[str] = mapped_column(String(10), default="monthly")
    alert_threshold_pct: Mapped[int] = mapped_column(Integer, default=80)
    hard_limit: Mapped[bool] = mapped_column(Boolean, default=False)  # block reservations above available
    __table_args__ = (CheckConstraint("allocated_minor > 0", name="ck_budget_positive"),)


class BudgetReservation(TimestampMixin, Base):
    __tablename__ = "budget_reservations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    budget_id: Mapped[str] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(255))
    agent_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | settled | released
    period_start: Mapped[date] = mapped_column(Date)
    settled_usage_id: Mapped[str | None] = mapped_column(ForeignKey("ai_usage_records.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    vendor: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))  # ai | api | hosting | domain | software | media | client | other
    direction: Mapped[str] = mapped_column(String(8), default="outgoing")  # outgoing (we pay) | incoming (client pays us)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    interval: Mapped[str] = mapped_column(String(10))  # weekly | monthly | quarterly | yearly
    next_renewal: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | trial | paused | cancelled
    account_id: Mapped[str | None] = mapped_column(ForeignKey("financial_accounts.id"), nullable=True)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("transaction_categories.id"), nullable=True)
    project: Mapped[str | None] = mapped_column(String(120), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (CheckConstraint("amount_minor > 0", name="ck_sub_positive"),)


class AIUsageRecord(TimestampMixin, Base):
    __tablename__ = "ai_usage_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))  # openai | xai | anthropic | other
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    project: Mapped[str | None] = mapped_column(String(120), nullable=True)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    occurred_on: Mapped[date] = mapped_column(Date, index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | csv | ragi | provider_api
    external_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    __table_args__ = (
        CheckConstraint("cost_minor >= 0", name="ck_usage_nonneg"),
        UniqueConstraint("workspace_id", "source", "external_ref", name="uq_usage_ext"),
    )


class SavingsGoal(TimestampMixin, Base):
    __tablename__ = "savings_goals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    target_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    account_id: Mapped[str | None] = mapped_column(ForeignKey("financial_accounts.id"), nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class EventOutbox(Base):
    """Versioned events for RAGI / authorised projects (see ecosystem-contracts). Not sent anywhere yet."""

    __tablename__ = "event_outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(60))
    schema_version: Mapped[str] = mapped_column(String(10), default="1.0")
    payload: Mapped[dict] = mapped_column(JSON)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EventInbox(Base):
    """Events received from RAGI / authorised projects; deduplicated on event_id."""

    __tablename__ = "event_inbox"
    event_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(60))
    source: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[str | None] = mapped_column(String(255), nullable=True)
