"""Normalise emails without rejecting reserved names such as .local (used in tests)."""
from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator


def normalize_email(value: str) -> str:
    v = (value or "").strip().lower()
    if not v or " " in v or len(v) > 320 or v.count("@") != 1:
        raise ValueError("Invalid email")
    local, _, domain = v.partition("@")
    if not local or not domain or "." not in domain:
        raise ValueError("Invalid email")
    return v


EmailAddress = Annotated[str, AfterValidator(normalize_email)]
