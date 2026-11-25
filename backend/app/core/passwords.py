"""Password policy: length 12–128, optional email/name rejection, breach check (fail-open).

No composition rules (NIST / auth-spec §5.2). Decision D5: HIBP is fail-open.
"""
from __future__ import annotations

import hashlib
import re

import httpx

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128

# Small built-in blocklist of very common passwords (auth-spec P0).
_COMMON = {
    "password", "password123", "password1234", "password123!", "passw0rd",
    "123456789012", "1234567890123", "qwertyuiopas", "qwertyuiopas1",
    "letmein12345", "welcome12345", "adminadmin12", "iloveyou1234",
}


def _norm(password: str) -> str:
    return re.sub(r"[^a-z0-9]", "", password.lower())


def password_issues(password: str, *, email: str = "", name: str = "") -> list[str]:
    """Return unmet rule labels (empty list means the password is acceptable)."""
    issues: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        issues.append("At least 12 characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        issues.append("No more than 128 characters")
    lowered = password.lower()
    local = (email or "").split("@")[0].lower()
    name_parts = [p for p in re.split(r"\s+", (name or "").lower()) if len(p) >= 3]
    if local and len(local) >= 3 and local in lowered:
        issues.append("Not your email or name")
    elif any(p in lowered for p in name_parts):
        issues.append("Not your email or name")
    if password.lower() in _COMMON or _norm(password) in {_norm(c) for c in _COMMON}:
        issues.append("Choose a less common password")
    return issues


def validate_password(password: str, *, email: str = "", name: str = "") -> None:
    issues = password_issues(password, email=email, name=name)
    if issues:
        raise ValueError("Password does not meet the rules: " + "; ".join(issues))


def hibp_pwned_count(password: str, *, client: httpx.Client | None = None) -> tuple[int | None, str]:
    """Return (count, status) where status is ok | skipped | pwned.

    Decision D5: when HIBP is unreachable, fail open (skipped) and do not block sign-up.
    """
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    own = client is None
    client = client or httpx.Client(timeout=2.5)
    try:
        resp = client.get(
            f"https://api.pwnedpasswords.com/range/{prefix}",
            headers={"Add-Padding": "true", "User-Agent": "Arnova-OMH"},
        )
        resp.raise_for_status()
    except httpx.HTTPError:
        return None, "skipped"
    finally:
        if own:
            client.close()
    count = 0
    for line in resp.text.splitlines():
        parts = line.split(":")
        if len(parts) == 2 and parts[0].strip().upper() == suffix:
            try:
                count = int(parts[1].strip().split("*")[0])
            except ValueError:
                count = 1
            break
    return count, ("pwned" if count else "ok")
