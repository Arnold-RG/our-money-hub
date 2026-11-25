"""Attach budgets to RAGI project ids and add outbox delivery backoff.

Revision ID: f6a708901234
Revises: e5f607890123
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "f6a708901234"
down_revision = "e5f607890123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("budgets") as batch:
        batch.add_column(sa.Column("ragi_project_id", sa.String(length=120), nullable=True))
        batch.create_index("ix_budgets_ragi_project_id", ["ragi_project_id"])
    with op.batch_alter_table("event_outbox") as batch:
        batch.add_column(sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("last_error", sa.String(length=500), nullable=True))
        batch.add_column(sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("event_outbox") as batch:
        batch.drop_column("next_attempt_at")
        batch.drop_column("last_error")
        batch.drop_column("attempts")
    with op.batch_alter_table("budgets") as batch:
        batch.drop_index("ix_budgets_ragi_project_id")
        batch.drop_column("ragi_project_id")
