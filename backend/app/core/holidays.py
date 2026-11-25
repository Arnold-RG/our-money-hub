"""Polish public holidays and business-day arithmetic (Europe/Warsaw).

Used to flag FX rates older than 2 Polish business days.
"""
from __future__ import annotations

from datetime import date, timedelta

# Fixed-date public holidays in Poland.
_FIXED = {
    (1, 1),   # New Year
    (1, 6),   # Epiphany
    (5, 1),   # Labour Day
    (5, 3),   # Constitution Day
    (8, 15),  # Assumption
    (11, 1),  # All Saints
    (11, 11), # Independence Day
    (12, 25), # Christmas
    (12, 26), # Second day of Christmas
}


def easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def polish_holidays(year: int) -> set[date]:
    easter = easter_sunday(year)
    movable = {
        easter,                       # Easter Sunday
        easter + timedelta(days=1),   # Easter Monday
        easter + timedelta(days=49),  # Pentecost Sunday
        easter + timedelta(days=60),  # Corpus Christi
    }
    fixed = {date(year, mo, da) for mo, da in _FIXED}
    return fixed | movable


def is_polish_business_day(d: date) -> bool:
    return d.weekday() < 5 and d not in polish_holidays(d.year)


def polish_business_days_between(start: date, end: date) -> int:
    """Count Polish business days in the half-open interval (start, end].

    Friday → Monday (no holiday) is 1. A holiday weekday in between is skipped.
    """
    if end <= start:
        return 0
    n = 0
    day = start + timedelta(days=1)
    while day <= end:
        if is_polish_business_day(day):
            n += 1
        day += timedelta(days=1)
    return n


def is_stale_rate(effective: date, on: date, *, max_business_days: int = 2) -> bool:
    return polish_business_days_between(effective, on) > max_business_days
