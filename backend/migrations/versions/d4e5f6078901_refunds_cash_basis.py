"""Refunds reduce their original category on a cash basis.

Revision ID: d4e5f6078901
Revises: c3d4e5f60789
Create Date: 2026-11-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6078901"
down_revision: Union[str, None] = "c3d4e5f60789"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("personal_finance_entries") as batch:
        batch.add_column(sa.Column("is_refund", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("is_refund", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("refund_of_id", sa.String(36), nullable=True))
    # SQLite needs the FK added separately in batch mode.
    with op.batch_alter_table("transactions") as batch:
        batch.create_foreign_key("fk_txn_refund_of", "transactions", ["refund_of_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_constraint("fk_txn_refund_of", type_="foreignkey")
        batch.drop_column("refund_of_id")
        batch.drop_column("is_refund")
    with op.batch_alter_table("personal_finance_entries") as batch:
        batch.drop_column("is_refund")
