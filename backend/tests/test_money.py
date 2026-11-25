from decimal import Decimal

import pytest

from app.core.money import (CurrencyMismatch, Money, MoneyError, PrecisionError, allocate_minor, convert,
                            monthly_equivalent, parse_amount)


@pytest.mark.parametrize("text,cur,minor", [
    ("12.50", "PLN", 1250), ("12,50", "PLN", 1250), ("1 234,56", "PLN", 123456), ("1,234.56", "USD", 123456),
    ("1.234,56", "EUR", 123456), ("-0.01", "EUR", -1), ("15000", "RWF", 15000), ("1,500,000", "RWF", 1500000),
    ("0.10", "USD", 10), ("100", "PLN", 10000),
])
def test_parse_amount(text, cur, minor):
    assert parse_amount(text, cur) == minor


@pytest.mark.parametrize("text,cur", [("10.5", "RWF"), ("0.001", "USD"), ("1.2345", "PLN")])
def test_parse_rejects_extra_precision(text, cur):
    with pytest.raises(PrecisionError):
        parse_amount(text, cur)


@pytest.mark.parametrize("text,cur", [("12,345", "PLN"), ("1.005", "PLN"), ("1e3", "PLN"), ("1_000", "PLN"),
                                      ("+5", "PLN"), ("\u0661\u0662", "PLN"), ("12,34,567", "RWF"), ("1,2,3", "EUR"),
                                      ("", "PLN"), ("NaN", "USD"), ("Infinity", "USD"), ("12.", "PLN")])
def test_parse_rejects_ambiguous_or_non_ascii(text, cur):
    with pytest.raises(MoneyError):
        parse_amount(text, cur)


def test_rwf_comma_is_thousands():
    assert parse_amount("1,234", "RWF") == 1234 and parse_amount("1 000 000", "RWF") == 1_000_000


def test_float_classic_trap_is_exact():
    # 0.1 + 0.2 must be exactly 0.30, never 0.30000000000000004
    assert (Money.parse("0.1", "USD") + Money.parse("0.2", "USD")).minor == 30


def test_never_add_different_currencies():
    with pytest.raises(CurrencyMismatch):
        Money(100, "PLN") + Money(100, "RWF")


def test_unsupported_currency():
    with pytest.raises(MoneyError):
        Money(1, "XXX")


def test_gbp_has_two_decimals():
    assert str(Money(1250, "GBP")) == "12.50 GBP"


def test_rwf_has_no_minor_unit():
    assert str(Money(15000, "RWF")) == "15000 RWF"
    assert str(Money(1250, "PLN")) == "12.50 PLN"


def test_convert_bankers_rounding():
    # 0.125 USD -> ROUND_HALF_EVEN to 0.12 ; 0.135 -> 0.14
    assert convert(Money(100, "EUR"), "USD", "0.00125").minor == 0  # 0.00125 USD -> 0.00
    assert convert(Money(1000, "PLN"), "USD", "0.0125").minor == 12  # 0.125 -> 0.12
    assert convert(Money(1000, "PLN"), "USD", "0.0135").minor == 14  # 0.135 -> 0.14


def test_convert_pln_to_rwf_with_real_nbp_rate():
    # NBP table B 046/B/NBP/2026: 1 RWF = 0.002717 PLN  =>  100.00 PLN = 36805.30... RWF -> 36805 RWF
    rate = Decimal(1) / Decimal("0.002717")
    assert convert(Money(10000, "PLN"), "RWF", rate).minor == 36805


def test_convert_rwf_to_pln():
    assert convert(Money(36805, "RWF"), "PLN", "0.002717").minor == 10000  # 99.999 -> 100.00


def test_allocation_sums_exactly():
    parts = allocate_minor(10000, [1, 1, 1])
    assert parts == [3334, 3333, 3333] and sum(parts) == 10000
    assert sum(allocate_minor(-101, [1, 1])) == -101
    assert Money(100, "RWF").split(3) == [Money(34, "RWF"), Money(33, "RWF"), Money(33, "RWF")]


@pytest.mark.parametrize("amount,interval,expected", [
    (Money(1200, "USD"), "monthly", 1200),
    (Money(12000, "PLN"), "yearly", 1000),
    (Money(10000, "PLN"), "yearly", 833),   # 8.3333 -> 8.33
    (Money(3000, "EUR"), "quarterly", 1000),
    (Money(1000, "PLN"), "weekly", 4333),   # 10 * 52/12 = 43.333
    (Money(5000, "RWF"), "weekly", 21667),  # 5000*52/12 = 21666.67 -> 21667
])
def test_monthly_equivalent(amount, interval, expected):
    assert monthly_equivalent(amount, interval).minor == expected


def test_money_requires_int():
    with pytest.raises(MoneyError):
        Money(1.5, "PLN")  # type: ignore[arg-type]
