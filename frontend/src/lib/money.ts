/**
 * Display helpers for money that arrives from the API as {amount: "123.45", minor: 12345, currency}.
 * No floating-point arithmetic is ever done on money in the browser: we format the decimal STRING,
 * and any sums the UI needs come from the API (which works in integer minor units).
 */
export type Currency = "PLN" | "RWF" | "EUR" | "USD" | "GBP";
export const CURRENCIES: Currency[] = ["PLN", "RWF", "EUR", "USD", "GBP"];
/** Menu order: RWF first; PLN stays the default reporting currency. */
export const SWITCHER_CURRENCIES: Currency[] = ["RWF", "PLN", "EUR", "USD", "GBP"];
export const MINOR_UNITS: Record<Currency, number> = { PLN: 2, RWF: 0, EUR: 2, USD: 2, GBP: 2 };
export const CURRENCY_LABEL: Record<Currency, string> = {
  PLN: "Polish złoty",
  RWF: "Rwandan franc",
  EUR: "Euro",
  USD: "US dollar",
  GBP: "Pound sterling",
};
const SYMBOL: Record<Currency, { s: string; after: boolean }> = {
  PLN: { s: "zł", after: true },
  RWF: { s: "RWF", after: true },
  EUR: { s: "€", after: false },
  USD: { s: "$", after: false },
  GBP: { s: "£", after: false },
};

export interface Money {
  amount: string;
  minor: number;
  currency: Currency;
}

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Format a decimal string exactly (no Number conversion). */
export function formatAmount(amount: string, currency: Currency, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const neg = amount.startsWith("-");
  const raw = neg ? amount.slice(1) : amount;
  const [i, f = ""] = raw.split(".");
  const exp = MINOR_UNITS[currency];
  let body: string;
  if (opts.compact && i.length > 6) {
    const millions = i.slice(0, i.length - 6);
    const dec = i.slice(i.length - 6, i.length - 5);
    body = `${group(millions, " ")}${dec !== "0" ? "." + dec : ""}M`;
  } else if (opts.compact && i.length > 4) {
    const thousands = i.slice(0, i.length - 3);
    const dec = i.slice(i.length - 3, i.length - 2);
    body = `${group(thousands, " ")}${dec !== "0" ? "." + dec : ""}k`;
  } else {
    body = group(i, "\u00a0") + (exp > 0 ? "." + f.padEnd(exp, "0").slice(0, exp) : "");
  }
  const sym = SYMBOL[currency];
  const withSym = sym.after ? `${body}\u00a0${sym.s}` : `${sym.s}${body}`;
  const sign = neg ? "−" : opts.sign && raw.replace(/[0.]/g, "") !== "" ? "+" : "";
  return sign + withSym;
}

export function fmt(m: Money | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!m) return "—";
  return formatAmount(m.amount, m.currency, opts);
}

/** Convert minor units (integer) to a decimal string exactly. */
export function minorToAmount(minor: number, currency: Currency): string {
  const exp = MINOR_UNITS[currency];
  const neg = minor < 0;
  const s = Math.abs(minor).toString().padStart(exp + 1, "0");
  const out = exp === 0 ? s : `${s.slice(0, s.length - exp)}.${s.slice(s.length - exp)}`;
  return (neg ? "-" : "") + out;
}

/** Validate what the user typed before sending (the API is the final authority). */
export function validateAmountInput(text: string, currency: Currency): string | null {
  const t = text.trim();
  if (!t) return "Enter an amount";
  if (!/^-?[0-9][0-9 .,]*$/.test(t)) return "Use digits only";
  const exp = MINOR_UNITS[currency];
  const m = t.match(/[.,](\d+)$/);
  if (m && m[1].length !== 3 && m[1].length > exp) {
    return exp === 0 ? "RWF has no decimals" : `${currency} allows ${exp} decimals`;
  }
  return null;
}

export function pct(fraction: string | null | undefined, digits = 0): string {
  if (fraction == null) return "—";
  const [i, f = ""] = fraction.split(".");
  const scaled = (i === "0" ? "" : i) + (f + "0000").slice(0, 2);
  const whole = scaled.replace(/^0+(?=\d)/, "") || "0";
  if (digits === 0) return `${whole}%`;
  return `${whole}.${(f + "0000").slice(2, 2 + digits)}%`;
}
