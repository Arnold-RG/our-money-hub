"""Timestamped exchange rates. Real sources only: National Bank of Poland (NBP) public API or manual entry."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import CURRENCIES, Money, convert, normalize_currency
from app.database.models import ExchangeRate

PIVOT = "PLN"  # NBP publishes every currency against PLN


@dataclass(frozen=True)
class RateQuote:
    rate: Decimal
    effective_date: date | None
    source: str


def _direct(db: Session, base: str, quote: str, on: date) -> ExchangeRate | None:
    return db.scalar(
        select(ExchangeRate)
        .where(ExchangeRate.base == base, ExchangeRate.quote == quote, ExchangeRate.effective_date <= on,
               ExchangeRate.rate_type == "mid")
        .order_by(ExchangeRate.effective_date.desc(), ExchangeRate.priority, ExchangeRate.fetched_at.desc())
        .limit(1)
    )


def _pair(db: Session, base: str, quote: str, on: date) -> RateQuote | None:
    """Best rate for base→quote on a date: newest effective date wins, then source priority
    (manual > NBP > ECB > BNR). Inverse quotes are used when they are newer or the only option."""
    cands = []
    r = _direct(db, base, quote, on)
    if r:
        cands.append((r.effective_date, -r.priority, 1, RateQuote(Decimal(r.rate), r.effective_date, r.source)))
    inv = _direct(db, quote, base, on)
    if inv:
        cands.append((inv.effective_date, -inv.priority, 0,
                      RateQuote(Decimal(1) / Decimal(inv.rate), inv.effective_date, f"inverse of {inv.source}")))
    if not cands:
        return None
    return max(cands, key=lambda c: c[:3])[3]


def get_rate(db: Session, base: str, quote: str, on: date) -> RateQuote | None:
    base, quote = normalize_currency(base), normalize_currency(quote)
    if base == quote:
        return RateQuote(Decimal(1), None, "identity")
    q = _pair(db, base, quote, on)
    if q:
        return q
    if PIVOT not in (base, quote):
        a, b = _pair(db, base, PIVOT, on), _pair(db, PIVOT, quote, on)
        if a and b:
            eff = min(d for d in (a.effective_date, b.effective_date) if d)
            return RateQuote(a.rate * b.rate, eff, f"cross via {PIVOT} ({a.source}; {b.source})")
    return None


def convert_on(db: Session, money: Money, to: str, on: date) -> Money | None:
    q = get_rate(db, money.currency, to, on)
    if not q:
        return None
    return money if money.currency == to else convert(money, to, q.rate)


class Converter:
    """Request-scoped cache so reports don't re-query the same rate thousands of times."""

    def __init__(self, db: Session, to: str):
        self.db, self.to = db, normalize_currency(to)
        self._cache: dict[tuple[str, date], RateQuote | None] = {}
        self.missing: set[str] = set()
        self.used: dict[str, RateQuote] = {}

    def __call__(self, money: Money, on: date) -> Money | None:
        if money.currency == self.to:
            return money
        key = (money.currency, on)
        if key not in self._cache:
            self._cache[key] = get_rate(self.db, money.currency, self.to, on)
        q = self._cache[key]
        if not q:
            self.missing.add(money.currency)
            return None
        self.used[money.currency] = q
        return convert(money, self.to, q.rate)


PRIORITY = {"manual": 0, "nbp": 1, "ecb": 2, "bnr": 3}
NBP_URL = "https://api.nbp.pl"
FRANKFURTER = "https://api.frankfurter.dev/v2"


def add_manual(db: Session, base: str, quote: str, rate: Decimal, effective: date, note: str | None = None) -> ExchangeRate:
    if rate <= 0:
        raise ValueError("Rate must be positive")
    r = ExchangeRate(base=normalize_currency(base), quote=normalize_currency(quote), rate=rate,
                     effective_date=effective, source=f"manual{': ' + note if note else ''}"[:120],
                     provider="manual", priority=PRIORITY["manual"])
    db.add(r)
    db.flush()
    return r


def _store(db: Session, *, base: str, quote: str, rate: Decimal, eff: date, source: str, provider: str,
           url: str, via: str | None = None, rate_type: str = "mid") -> ExchangeRate:
    exists = db.scalar(select(ExchangeRate).where(ExchangeRate.base == base, ExchangeRate.quote == quote,
                                                  ExchangeRate.effective_date == eff, ExchangeRate.source == source,
                                                  ExchangeRate.rate_type == rate_type))
    if exists:
        return exists
    r = ExchangeRate(base=base, quote=quote, rate=rate, effective_date=eff, source=source[:120], provider=provider,
                     via=via, rate_type=rate_type, source_url=url, priority=PRIORITY[provider])
    db.add(r)
    db.flush()
    return r


def sync_nbp(db: Session, client: httpx.Client) -> list[ExchangeRate]:
    """Official NBP mids vs PLN: EUR, USD from table A (daily), RWF from table B (weekly)."""
    s = get_settings()
    out = []
    for code in CURRENCIES:
        if code == PIVOT:
            continue
        table = "B" if code == "RWF" else "A"
        resp = client.get(f"{s.nbp_api_base}/exchangerates/rates/{table}/{code}/", params={"format": "json"})
        resp.raise_for_status()
        item = resp.json()["rates"][0]
        out.append(_store(db, base=code, quote=PIVOT, rate=Decimal(str(item["mid"])),
                          eff=date.fromisoformat(item["effectiveDate"]), source=f"NBP table {table} {item['no']}",
                          provider="nbp", url="https://nbp.pl"))
    return out


def sync_ecb(db: Session, client: httpx.Client) -> list[ExchangeRate]:
    """ECB euro reference rates (EUR→USD, EUR→PLN) relayed by Frankfurter. ECB publishes no RWF rate."""
    resp = client.get(f"{FRANKFURTER}/rates", params={"base": "EUR", "quotes": "USD,PLN", "providers": "ecb"})
    resp.raise_for_status()
    return [_store(db, base="EUR", quote=i["quote"], rate=Decimal(str(i["rate"])), eff=date.fromisoformat(i["date"]),
                   source="ECB euro reference rate", provider="ecb", via="frankfurter.dev",
                   url="https://data.ecb.europa.eu/") for i in resp.json() if i.get("quote") in CURRENCIES]


def sync_bnr(db: Session, client: httpx.Client) -> list[ExchangeRate]:
    """National Bank of Rwanda reference rates (RWF→USD/EUR/PLN) relayed by Frankfurter until BNR API access is granted."""
    resp = client.get(f"{FRANKFURTER}/providers/bnrrw/rates", params={"base": "RWF"})
    resp.raise_for_status()
    return [_store(db, base="RWF", quote=i["quote"], rate=Decimal(str(i["rate"])), eff=date.fromisoformat(i["date"]),
                   source="BNR reference rate", provider="bnr", via="frankfurter.dev", url="https://www.bnr.rw/exchangeRate")
            for i in resp.json() if i.get("quote") in CURRENCIES]


def sync_all(db: Session, client: httpx.Client | None = None) -> dict:
    own = client is None
    client = client or httpx.Client(timeout=15)
    result: dict = {"stored": [], "errors": {}}
    try:
        for name, fn in (("nbp", sync_nbp), ("ecb", sync_ecb), ("bnr", sync_bnr)):
            try:
                result["stored"] += fn(db, client)
            except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
                result["errors"][name] = str(exc)[:200]
    finally:
        if own:
            client.close()
    return result


def latest_rates(db: Session) -> list[ExchangeRate]:
    out = []
    for code in CURRENCIES:
        for other in CURRENCIES:
            if code == other:
                continue
            rows = db.scalars(select(ExchangeRate).where(ExchangeRate.base == code, ExchangeRate.quote == other)
                              .order_by(ExchangeRate.provider, ExchangeRate.effective_date.desc())).all()
            seen = set()
            for r in rows:  # newest per provider
                if r.provider not in seen:
                    seen.add(r.provider)
                    out.append(r)
    return out
