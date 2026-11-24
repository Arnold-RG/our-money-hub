from __future__ import annotations

import calendar
from datetime import date, timedelta


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def next_occurrence(d: date, interval: str) -> date:
    if interval == "weekly":
        return d + timedelta(days=7)
    if interval == "monthly":
        return add_months(d, 1)
    if interval == "quarterly":
        return add_months(d, 3)
    if interval == "yearly":
        return add_months(d, 12)
    raise ValueError(f"Unknown interval {interval!r}")


def parse_month(s: str | None, today: date) -> date:
    if not s:
        return month_start(today)
    y, m = s.split("-")[:2]
    return date(int(y), int(m), 1)
