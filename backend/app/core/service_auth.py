"""Service-to-service authentication (contract: ecosystem-contracts/docs/authentication.md).

Every service call carries:
  X-Arnova-Key-Id     the caller's key id (kid)
  X-Arnova-Timestamp  Unix seconds, accepted within ±ECOSYSTEM_MAX_CLOCK_SKEW_SECONDS
  X-Arnova-Signature  "sha256=" + hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))
Keys live in ECOSYSTEM_KEYRING_JSON (preferred on Render, no disk) or a JSON file
(ECOSYSTEM_KEYRING_FILE, for local development). Each key has a service, scopes and an
optional not_before/not_after window, so several keys can be active during rotation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings

SERVICE_HEADERS = ("x-arnova-key-id", "x-arnova-timestamp", "x-arnova-signature")


class ServiceAuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass
class ServiceKey:
    kid: str
    service: str
    secret: str
    scopes: list[str] = field(default_factory=list)
    not_before: datetime | None = None
    not_after: datetime | None = None

    def active(self, now: datetime) -> bool:
        return (self.not_before is None or now >= self.not_before) and (self.not_after is None or now < self.not_after)


def _dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


def parse_keyring(raw: dict) -> dict[str, ServiceKey]:
    out: dict[str, ServiceKey] = {}
    for k in raw.get("keys", []):
        if len(k.get("secret", "")) < 32:
            raise ValueError(f"Key {k.get('kid')} secret is too short (min 32 chars)")
        out[k["kid"]] = ServiceKey(k["kid"], k["service"], k["secret"], list(k.get("scopes", [])),
                                   _dt(k.get("not_before")), _dt(k.get("not_after")))
    return out


def load_keyring(path: str | None = None) -> dict[str, ServiceKey]:
    """Load keys from an explicit file path, or from env JSON, or from ECOSYSTEM_KEYRING_FILE."""
    if path is not None:
        if not path or not Path(path).exists():
            return {}
        return parse_keyring(json.loads(Path(path).read_text()))
    s = get_settings()
    blob = (s.ecosystem_keyring_json or "").strip()
    if blob:
        return parse_keyring(json.loads(blob))
    file_path = s.ecosystem_keyring_file
    if not file_path or not Path(file_path).exists():
        return {}
    return parse_keyring(json.loads(Path(file_path).read_text()))


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def signed_headers(body: bytes) -> dict[str, str]:
    """Sign an outgoing request with OMH's active signing key."""
    s = get_settings()
    keyring = load_keyring()
    key = keyring.get(s.ecosystem_signing_key_id or "")
    if not key or key.service != "omh" or not key.active(datetime.now(UTC)):
        raise ServiceAuthError(503, "No active OMH signing key")
    ts = str(int(time.time()))
    return {"X-Arnova-Key-Id": key.kid, "X-Arnova-Timestamp": ts, "X-Arnova-Signature": sign(key.secret, ts, body),
            "Content-Type": "application/json"}


def is_service_call(headers) -> bool:
    return any(h in headers for h in SERVICE_HEADERS)


def verify(headers, body: bytes, *, scope: str, now: float | None = None,
           keyring: dict[str, ServiceKey] | None = None) -> ServiceKey:
    keyring = load_keyring() if keyring is None else keyring
    if not keyring:
        raise ServiceAuthError(503, "Service authentication is not configured")
    kid, ts, sig = (headers.get(h) for h in SERVICE_HEADERS)
    if not kid or not ts or not sig:
        raise ServiceAuthError(401, "Missing service authentication headers")
    current = time.time() if now is None else now
    key = keyring.get(kid)
    if not key or not key.active(datetime.fromtimestamp(current, UTC)):
        raise ServiceAuthError(401, "Unknown or expired key")
    if not ts.isascii() or not ts.isdigit():
        raise ServiceAuthError(401, "Bad timestamp")
    if abs(current - int(ts)) > get_settings().ecosystem_max_clock_skew_seconds:
        raise ServiceAuthError(401, "Timestamp outside the allowed window")
    if not hmac.compare_digest(sign(key.secret, ts, body), sig):
        raise ServiceAuthError(401, "Invalid signature")
    if scope not in key.scopes:
        raise ServiceAuthError(403, f"Key lacks scope {scope}")
    return key
