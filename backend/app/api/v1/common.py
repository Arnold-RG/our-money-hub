from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo
from datetime import datetime

from fastapi import HTTPException

from app.core.money import MoneyError, format_plain, normalize_currency, parse_amount

TZ = ZoneInfo("Europe/Warsaw")


def today() -> date:
    return datetime.now(TZ).date()


def money_out(minor: int | None, currency: str) -> dict | None:
    if minor is None:
        return None
    return {"amount": format_plain(minor, currency), "minor": minor, "currency": currency}


def parse_money(amount: str, currency: str, field: str = "amount") -> tuple[int, str]:
    try:
        cur = normalize_currency(currency)
        return parse_amount(str(amount), cur), cur
    except MoneyError as e:
        raise HTTPException(422, f"{field}: {e}") from e


def bad(msg: str, code: int = 400) -> HTTPException:
    return HTTPException(code, msg)
