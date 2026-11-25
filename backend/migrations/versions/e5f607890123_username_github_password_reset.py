"""Usernames, GitHub identities, and email reset codes.

Revision ID: e5f607890123
Revises: d4e5f6078901
"""
from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5f607890123"
down_revision: Union[str, None] = "d4e5f6078901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("username", sa.String(length=32), nullable=True))
        batch.alter_column("password_hash", existing_type=sa.String(length=255), nullable=True)
        batch.create_index("ix_users_username", ["username"], unique=True)

    op.create_table(
        "auth_identities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("provider", "subject", name="uq_omh_auth_identity"),
    )
    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_ip", sa.String(length=64), nullable=True),
    )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, email FROM users")).fetchall()
    used: set[str] = set()
    for user_id, email in rows:
        local = (email or "user").split("@")[0].lower()
        slug = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in local)
        if not slug or not slug[0].isalpha():
            slug = f"user_{str(user_id).replace('-', '')[:12]}"
        slug = slug[:28]
        candidate = slug
        n = 1
        while candidate in used:
            n += 1
            candidate = f"{slug}_{n}"
        used.add(candidate)
        conn.execute(sa.text("UPDATE users SET username = :u WHERE id = :id"), {"u": candidate, "id": user_id})


def downgrade() -> None:
    op.drop_table("password_reset_codes")
    op.drop_table("auth_identities")
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_username")
        batch.drop_column("username")
        batch.alter_column("password_hash", existing_type=sa.String(length=255), nullable=False)
