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


def next_occurrence(d: date, interval: str, anchor_day: int | None = None) -> date:
    anchor = anchor_day or d.day
    if interval == "weekly":
        return d + timedelta(days=7)
    if interval == "monthly":
        return add_months_anchored(d, 1, anchor)
    if interval == "quarterly":
        return add_months_anchored(d, 3, anchor)
    if interval == "yearly":
        return add_months_anchored(d, 12, anchor)
    raise ValueError(f"Unknown interval {interval!r}")


def parse_month(s: str | None, today: date) -> date:
    if not s:
        return month_start(today)
    try:
        y, m = s.split("-")[:2]
        return date(int(y), int(m), 1)
    except (ValueError, TypeError) as exc:
        from fastapi import HTTPException

        raise HTTPException(422, "month must be YYYY-MM") from exc


def add_months_anchored(d: date, n: int, anchor_day: int) -> date:
    """Month arithmetic that keeps the original billing day (31 Jan → 28 Feb → 31 Mar)."""
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return date(y, m, min(anchor_day, calendar.monthrange(y, m)[1]))
