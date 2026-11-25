"""Hashed, email-bound, single-use invites (TTL 72 h), scoped to one workspace + role."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import AuthToken, FinancialWorkspace

INVITE_TTL = timedelta(hours=72)
INVITE_ROLES = {"viewer", "editor"}
GENERIC = "This invite can’t be used. Ask the owner for a new one."
INVITE_COOKIE = "__Host-omh_invite"
INVITE_COOKIE_MAX_AGE = 10 * 60


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db: Session, *, email: str, role: str, workspace_id: str, created_by: str | None) -> str:
    if role not in INVITE_ROLES:
        raise ValueError("Invites can only grant viewer or editor")
    ws = db.get(FinancialWorkspace, workspace_id)
    if not ws:
        raise ValueError(GENERIC)
    raw = secrets.token_urlsafe(32)
    db.add(AuthToken(
        kind="invite",
        token_hash=_hash(raw),
        email=email.strip().lower(),
        role=role,
        workspace_id=workspace_id,
        created_by=created_by,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    ))
    db.flush()
    return raw


def lookup(db: Session, token: str | None) -> AuthToken | None:
    if not token:
        return None
    return db.scalar(select(AuthToken).where(AuthToken.token_hash == _hash(token), AuthToken.kind == "invite"))


def is_usable(row: AuthToken | None) -> bool:
    if row is None:
        return False
    now = datetime.now(UTC)
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
    return row.revoked_at is None and row.used_at is None and exp > now


def consume(db: Session, token: str, email: str) -> AuthToken:
    row = lookup(db, token)
    if not is_usable(row) or (row.email or "") != email.strip().lower():
        raise ValueError(GENERIC)
    row.used_at = datetime.now(UTC)
    db.flush()
    return row


def preview(db: Session, row: AuthToken) -> dict:
    ws = db.get(FinancialWorkspace, row.workspace_id) if row.workspace_id else None
    return {
        "email": row.email,
        "role": row.role,
        "workspace_id": row.workspace_id,
        "workspace_name": ws.name if ws else None,
        "expires_at": row.expires_at.isoformat(),
        "ttl_hours": 72,
        "single_use": True,
    }
