"""In-process outbox delivery to RAGI.

Retries with exponential backoff so a Render free-tier cold start can succeed.
Disabled when APP_ENV is test, when delivery is off, or when RAGI is not configured.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import or_, select

from app.core.config import get_settings
from app.core.service_auth import ServiceAuthError, load_keyring, signed_headers
from app.database.session import SessionLocal
from app.database.models import EventOutbox

log = logging.getLogger(__name__)

POLL_SECONDS = 15
BACKOFF = (5, 15, 30, 60, 120, 180)
EVENTS_PATH = "/api/v1/events"


def configured() -> bool:
    """Outbound delivery to other apps is disabled."""
    return False




def backoff_seconds(attempts: int) -> int:
    if attempts <= 0:
        return 0
    return BACKOFF[min(attempts, len(BACKOFF)) - 1]


def due_rows(db, limit: int = 20) -> list[EventOutbox]:
    now = datetime.now(UTC)
    return list(db.scalars(
        select(EventOutbox).where(
            EventOutbox.published_at.is_(None),
            or_(EventOutbox.next_attempt_at.is_(None), EventOutbox.next_attempt_at <= now),
        ).order_by(EventOutbox.occurred_at).limit(limit)
    ))


def _post(url: str, body: bytes, headers: dict[str, str]) -> httpx.Response:
    with httpx.Client(timeout=20.0) as client:
        return client.post(url, content=body, headers=headers)


def deliver_one(row: EventOutbox) -> tuple[bool, str | None, bool]:
    s = get_settings()
    if not s.ragi_api_url:
        return False, "RAGI_API_URL is not set", False
    try:
        payload = row.payload if isinstance(row.payload, dict) else {}
        body = json.dumps(payload, separators=(",", ":")).encode()
        headers = signed_headers(body)
    except ServiceAuthError as exc:
        return False, str(exc), False
    url = s.ragi_api_url.rstrip("/") + EVENTS_PATH
    try:
        response = _post(url, body, headers)
    except httpx.HTTPError as exc:
        return False, exc.__class__.__name__, True
    if response.status_code in {200, 201, 202}:
        return True, None, False
    if response.status_code in {408, 425, 429, 500, 502, 503, 504}:
        return False, f"HTTP {response.status_code}", True
    return False, f"HTTP {response.status_code}", False


def pump_once() -> int:
    if not configured():
        return 0
    delivered = 0
    db = SessionLocal()
    try:
        for row in due_rows(db):
            ok, error, retryable = deliver_one(row)
            row.attempts = (row.attempts or 0) + 1
            if ok:
                row.published_at = datetime.now(UTC)
                row.last_error = None
                row.next_attempt_at = None
                delivered += 1
            else:
                row.last_error = (error or "delivery failed")[:500]
                if retryable:
                    row.next_attempt_at = datetime.now(UTC) + timedelta(seconds=backoff_seconds(row.attempts))
                else:
                    # Permanent failure: leave unpublished but push the next try far away so it is visible in the outbox.
                    row.next_attempt_at = datetime.now(UTC) + timedelta(days=365)
            db.commit()
    finally:
        db.close()
    return delivered


async def delivery_loop() -> None:
    while True:
        try:
            if get_settings().app_env not in {"test"}:
                await asyncio.to_thread(pump_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Outbox delivery cycle failed")
        await asyncio.sleep(POLL_SECONDS)
