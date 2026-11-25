"""Username rules: 3–32 chars, start with a letter, letters/numbers/underscores, unique."""
from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
RESERVED = frozenset({
    "admin", "administrator", "owner", "root", "system", "support", "security",
    "ragi", "omh", "ourmoneyhub", "our_money_hub", "arnova", "arnovagroup",
    "help", "api", "auth", "login", "signup", "setup", "null", "undefined",
    "me", "user", "users", "moderator", "staff",
})


def normalize_username(raw: str) -> str:
    return (raw or "").strip().lower()


def validate_username(raw: str) -> str:
    name = normalize_username(raw)
    if not USERNAME_RE.fullmatch(name):
        raise ValueError(
            "Username must be 3–32 characters, start with a letter, and use only letters, numbers and underscores"
        )
    if name in RESERVED:
        raise ValueError("That username is not available")
    return name


def is_available(db: Session, model, name: str) -> bool:
    return db.scalar(select(model).where(func.lower(model.username) == name)) is None


def from_github_login(db: Session, model, login: str, subject: str) -> str:
    slug = re.sub(r"[^a-z0-9_]", "_", (login or "").lower()).strip("_")
    if not slug or not slug[0].isalpha():
        suffix = re.sub(r"[^a-z0-9]", "", (subject or "x").lower())[:16] or "x"
        slug = f"user_{suffix}"
    slug = slug[:28]
    candidate = slug
    n = 1
    while not is_available(db, model, candidate):
        n += 1
        candidate = f"{slug}_{n}"
    return candidate
