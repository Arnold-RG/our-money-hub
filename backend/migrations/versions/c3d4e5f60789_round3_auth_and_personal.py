"""Round 3: auth hardening, invites, personal finance, future projects.

Revision ID: c3d4e5f60789
Revises: a1b2c3d4e5f6
Create Date: 2026-11-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f60789"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("mfa_failures", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("mfa_locked_until", sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table("user_sessions") as batch:
        batch.add_column(sa.Column("enrolment_required", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("reauth_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "mfa_recovery_codes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "instance_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("role", sa.String(20), nullable=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("financial_workspaces.id"), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_tokens_token_hash", "auth_tokens", ["token_hash"], unique=True)
    op.create_table(
        "rate_limit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("bucket", sa.String(200), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
    )
    op.create_table(
        "auth_backoffs",
        sa.Column("key", sa.String(320), primary_key=True),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "personal_finance_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("category in ('income','living','usage','savings')", name="ck_pf_category"),
        sa.CheckConstraint("currency in ('PLN','RWF','EUR','USD','GBP')", name="ck_pf_currency"),
    )
    op.create_table(
        "future_projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("financial_workspaces.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("planned_minor", sa.BigInteger(), nullable=False),
        sa.Column("funded_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="PLN"),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("planned_minor >= 0", name="ck_fp_planned"),
        sa.CheckConstraint("funded_minor >= 0", name="ck_fp_funded"),
        sa.CheckConstraint("currency in ('PLN','RWF','EUR','USD','GBP')", name="ck_fp_currency"),
    )


def downgrade() -> None:
    op.drop_table("future_projects")
    op.drop_table("personal_finance_entries")
    op.drop_table("auth_backoffs")
    op.drop_table("rate_limit_events")
    op.drop_table("auth_tokens")
    op.drop_table("instance_settings")
    op.drop_table("mfa_recovery_codes")
    with op.batch_alter_table("user_sessions") as batch:
        batch.drop_column("reauth_at")
        batch.drop_column("last_seen_at")
        batch.drop_column("enrolment_required")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("mfa_locked_until")
        batch.drop_column("mfa_failures")
