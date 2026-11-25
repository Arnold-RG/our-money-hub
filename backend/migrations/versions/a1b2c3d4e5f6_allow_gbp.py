"""Allow GBP alongside PLN, RWF, EUR and USD.

Revision ID: a1b2c3d4e5f6
Revises: 7917f698a8c1
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "7917f698a8c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW = "currency in ('PLN','RWF','EUR','USD','GBP')"
OLD = "currency in ('PLN','RWF','EUR','USD')"
TABLES = (("financial_accounts", "ck_acct_currency"), ("transactions", "ck_txn_currency"))


def upgrade() -> None:
    for table, name in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name)
            batch.create_check_constraint(name, NEW)


def downgrade() -> None:
    for table, name in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name)
            batch.create_check_constraint(name, OLD)
