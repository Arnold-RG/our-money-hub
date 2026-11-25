"""MFA recovery codes: 10 codes, 10 characters, look-alike-free, single use."""
from __future__ import annotations

import hmac
import secrets
import string

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import MfaRecoveryCode

ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in {"0", "O", "1", "I", "L"})
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)


def generate_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(10))


def issue_codes(db: Session, user_id: str, n: int = 10) -> list[str]:
    """Replace any existing unused codes and return the new plaintext codes (shown once)."""
    existing = db.scalars(select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id)).all()
    for row in existing:
        db.delete(row)
    db.flush()
    codes = [generate_code() for _ in range(n)]
    # Ensure uniqueness within the set.
    while len(set(codes)) < n:
        codes = [generate_code() for _ in range(n)]
    for code in codes:
        db.add(MfaRecoveryCode(user_id=user_id, code_hash=_hasher.hash(code)))
    db.flush()
    return codes


def remaining_count(db: Session, user_id: str) -> int:
    return sum(1 for c in db.scalars(select(MfaRecoveryCode).where(
        MfaRecoveryCode.user_id == user_id, MfaRecoveryCode.used_at.is_(None))) )


def consume_code(db: Session, user_id: str, code: str) -> bool:
    """Constant-time-ish compare against all unused hashes. Marks a match used."""
    raw = (code or "").strip().replace(" ", "").upper()
    if len(raw) != 10 or any(c not in ALPHABET for c in raw):
        # Still walk hashes so timing does not advertise format too cheaply.
        raw = "INVALIDCODE"
    unused = db.scalars(select(MfaRecoveryCode).where(
        MfaRecoveryCode.user_id == user_id, MfaRecoveryCode.used_at.is_(None))).all()
    matched = None
    # Always verify against every row (and a dummy if none) so absence is not obvious.
    dummy = _hasher.hash("dummy-recovery")
    for row in unused or [type("X", (), {"code_hash": dummy, "id": None})()]:
        try:
            ok = _hasher.verify(row.code_hash, raw)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            ok = False
        if ok and getattr(row, "id", None) and matched is None:
            matched = row
    if matched is None:
        return False
    from datetime import UTC, datetime
    matched.used_at = datetime.now(UTC)
    db.flush()
    return True
