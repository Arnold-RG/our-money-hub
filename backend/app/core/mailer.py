"""Transactional email via Resend. Missing config or API errors never leak to callers."""
from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)


def send_email(*, to: str, subject: str, text: str, html: str | None = None) -> str:
    """Return sent, skipped (unconfigured) or failed. Does not raise for delivery problems."""
    s = get_settings()
    key = (s.resend_api_key or "").strip()
    mail_from = (s.mail_from or "").strip()
    if not key or not mail_from:
        log.warning("email skipped: RESEND_API_KEY or MAIL_FROM is not set")
        return "skipped"
    payload: dict = {"from": mail_from, "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=10.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError:
        log.exception("email send failed")
        return "failed"
    return "sent"
