"""Exact money arithmetic for Our Money Hub.

Rules (see docs/FINANCIAL_ENGINE.md):
* Every stored amount is an integer count of the currency's minor unit
  (grosz for PLN, cent for EUR/USD, whole francs for RWF which has no minor unit).
* Arithmetic is only allowed between amounts of the same currency.
  Mixing currencies raises ``CurrencyMismatch``; conversion must be explicit and
  use a timestamped exchange rate.
* Rounding uses ROUND_HALF_EVEN (banker's rounding) so long series of
  conversions do not drift in one direction.
* Splitting an amount (allocations, normalising yearly plans to months) uses the
  largest-remainder method so the parts always add back to the exact total.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

# ISO 4217 minor-unit exponents for supported currencies.
CURRENCIES: dict[str, int] = {"PLN": 2, "EUR": 2, "USD": 2, "RWF": 0}
CURRENCY_NAMES: dict[str, str] = {
    "PLN": "Polish złoty",
    "RWF": "Rwandan franc",
    "EUR": "Euro",
    "USD": "US dollar",
}
ROUNDING = ROUND_HALF_EVEN


class MoneyError(ValueError):
    pass


class CurrencyMismatch(MoneyError):
    pass


class UnsupportedCurrency(MoneyError):
    pass


class PrecisionError(MoneyError):
    pass


def exponent(currency: str) -> int:
    try:
        return CURRENCIES[currency]
    except KeyError as exc:  # pragma: no cover - message path
        raise UnsupportedCurrency(f"Unsupported currency: {currency!r}") from exc


def normalize_currency(code: str) -> str:
    code = (code or "").strip().upper()
    exponent(code)
    return code


def parse_amount(value: str | int | Decimal, currency: str, *, strict: bool = True) -> int:
    """Parse a human/CSV amount into minor units.

    ``strict`` rejects more decimal places than the currency allows
    (e.g. ``"10.5"`` RWF or ``"1.005"`` PLN) instead of silently rounding.
    Accepts ``1 234,56`` / ``1,234.56`` / ``-12.30`` style input.
    """
    currency = normalize_currency(currency)
    exp = exponent(currency)
    if isinstance(value, int):
        raise MoneyError("Pass amounts as strings or Decimal, not int major units")
    if isinstance(value, Decimal):
        dec = value
    else:
        text = str(value).strip().replace("\u00a0", "").replace(" ", "")
        if not text:
            raise MoneyError("Empty amount")
        if "," in text and "." in text:
            # whichever separator appears last is the decimal separator
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            head, _, tail = text.rpartition(",")
            if text.count(",") > 1 or len(tail) == 3:
                text = text.replace(",", "")  # thousands separators: 1,234 / 1,234,567
            else:
                text = f"{head}.{tail}"  # decimal comma: 12,50
        try:
            dec = Decimal(text)
        except InvalidOperation as exc:
            raise MoneyError(f"Not a number: {value!r}") from exc
    if not dec.is_finite():
        raise MoneyError("Amount must be finite")
    quant = Decimal(1).scaleb(-exp)
    rounded = dec.quantize(quant, rounding=ROUNDING)
    if strict and rounded != dec:
        raise PrecisionError(f"{currency} allows {exp} decimal place(s); got {value!r}")
    return int(rounded.scaleb(exp))


def to_decimal(minor: int, currency: str) -> Decimal:
    return Decimal(minor).scaleb(-exponent(currency))


def format_plain(minor: int, currency: str) -> str:
    exp = exponent(currency)
    return f"{to_decimal(minor, currency):.{exp}f}"


@dataclass(frozen=True, slots=True)
class Money:
    minor: int
    currency: str

    def __post_init__(self) -> None:
        if not isinstance(self.minor, int) or isinstance(self.minor, bool):
            raise MoneyError("Money.minor must be an int")
        object.__setattr__(self, "currency", normalize_currency(self.currency))

    @classmethod
    def zero(cls, currency: str) -> Money:
        return cls(0, currency)

    @classmethod
    def parse(cls, value: str | Decimal, currency: str) -> Money:
        return cls(parse_amount(value, currency), currency)

    def _check(self, other: Money) -> None:
        if not isinstance(other, Money):
            raise TypeError("Can only combine Money with Money")
        if other.currency != self.currency:
            raise CurrencyMismatch(f"Cannot combine {self.currency} with {other.currency} without conversion")

    def __add__(self, other: Money) -> Money:
        self._check(other)
        return Money(self.minor + other.minor, self.currency)

    def __sub__(self, other: Money) -> Money:
        self._check(other)
        return Money(self.minor - other.minor, self.currency)

    def __neg__(self) -> Money:
        return Money(-self.minor, self.currency)

    def __lt__(self, other: Money) -> bool:
        self._check(other)
        return self.minor < other.minor

    def __le__(self, other: Money) -> bool:
        self._check(other)
        return self.minor <= other.minor

    @property
    def amount(self) -> Decimal:
        return to_decimal(self.minor, self.currency)

    def __str__(self) -> str:
        return f"{format_plain(self.minor, self.currency)} {self.currency}"

    def multiply(self, factor: Decimal | int | str) -> Money:
        """Multiply by an exact factor, rounding once at the end."""
        result = Decimal(self.minor) * Decimal(str(factor))
        return Money(int(result.quantize(Decimal(1), rounding=ROUNDING)), self.currency)

    def allocate(self, ratios: list[int | Decimal]) -> list[Money]:
        """Split into parts proportional to ``ratios``; parts sum exactly to self."""
        return [Money(p, self.currency) for p in allocate_minor(self.minor, ratios)]

    def split(self, n: int) -> list[Money]:
        return self.allocate([1] * n)


def allocate_minor(total: int, ratios: list[int | Decimal]) -> list[int]:
    """Largest-remainder allocation of an integer total.

    Deterministic: ties go to the earliest part. Works for negative totals.
    """
    if not ratios:
        raise MoneyError("At least one ratio required")
    weights = [Decimal(str(r)) for r in ratios]
    if any(w < 0 for w in weights):
        raise MoneyError("Ratios must be non-negative")
    s = sum(weights)
    if s == 0:
        raise MoneyError("Ratios must not all be zero")
    sign = -1 if total < 0 else 1
    t = abs(total)
    exact = [Decimal(t) * w / s for w in weights]
    floors = [int(e) for e in exact]
    remainder = t - sum(floors)
    order = sorted(range(len(exact)), key=lambda i: (-(exact[i] - floors[i]), i))
    for i in order[:remainder]:
        floors[i] += 1
    return [sign * f for f in floors]


def convert(money: Money, to_currency: str, rate: Decimal | str) -> Money:
    """Convert using ``rate`` = units of ``to_currency`` per 1 unit of ``money.currency``."""
    to_currency = normalize_currency(to_currency)
    rate = Decimal(str(rate))
    if rate <= 0:
        raise MoneyError("Exchange rate must be positive")
    if to_currency == money.currency:
        if rate != 1:
            raise MoneyError("Same-currency conversion must use rate 1")
        return money
    major = money.amount * rate
    exp = exponent(to_currency)
    quant = Decimal(1).scaleb(-exp)
    return Money(int(major.quantize(quant, rounding=ROUNDING).scaleb(exp)), to_currency)


INTERVAL_MONTHS: dict[str, Decimal] = {
    "monthly": Decimal(1),
    "quarterly": Decimal(3),
    "yearly": Decimal(12),
}


def monthly_equivalent(amount: Money, interval: str) -> Money:
    """Normalise a recurring charge to a monthly amount (exact, rounded once)."""
    if interval == "weekly":
        # 52 weeks / 12 months
        return amount.multiply(Decimal(52) / Decimal(12))
    if interval not in INTERVAL_MONTHS:
        raise MoneyError(f"Unknown interval {interval!r}")
    months = INTERVAL_MONTHS[interval]
    if months == 1:
        return amount
    return amount.multiply(Decimal(1) / months)


def annual_from_monthly(monthly: Money) -> Money:
    return Money(monthly.minor * 12, monthly.currency)
