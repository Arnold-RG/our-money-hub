"""Client IP used for rate limits. Trust X-Forwarded-For only from the Next.js proxy."""
from __future__ import annotations

import ipaddress

from fastapi import Request

from app.core.config import get_settings


def _parse_allowlist(raw: str | list[str] | None) -> set[str]:
    if raw is None:
        return {"127.0.0.1", "::1"}
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",") if p.strip()]
    else:
        parts = list(raw)
    return set(parts) or {"127.0.0.1", "::1"}


def bucket_ip(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip or "unknown"
    if isinstance(addr, ipaddress.IPv6Address):
        net = ipaddress.ip_network(f"{addr}/64", strict=False)
        return str(net.network_address) + "/64"
    return str(addr)


def client_ip(request: Request) -> str:
    """Return the real client IP, bucketed for IPv6 (/64).

    uvicorn may already rewrite request.client when --proxy-headers is on. We
    still only honour X-Forwarded-For when the immediate peer is in the
    allow-list, so a forged header from the public internet is ignored.
    """
    peer = request.client.host if request.client else ""
    allowed = _parse_allowlist(getattr(get_settings(), "forwarded_allow_ips", None))
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    chosen = peer or "unknown"
    if peer in allowed and forwarded:
        chosen = forwarded
    return bucket_ip(chosen)
