import { describe, expect, it } from "vitest";
import { formatAmount, minorToAmount, pct, validateAmountInput } from "@/lib/money";

describe("formatAmount", () => {
  it("formats PLN with grouping and symbol after", () => {
    expect(formatAmount("1234567.89", "PLN")).toBe("1\u00a0234\u00a0567.89\u00a0zł");
  });
  it("formats RWF with no decimals", () => {
    expect(formatAmount("368053", "RWF")).toBe("368\u00a0053\u00a0RWF");
  });
  it("formats EUR/USD with leading symbol and real minus sign", () => {
    expect(formatAmount("-12.30", "EUR")).toBe("−€12.30");
    expect(formatAmount("0.10", "USD", { sign: true })).toBe("+$0.10");
  });
  it("never converts through floats", () => {
    // 0.1 + 0.2 style traps can't happen: we only reformat the exact string
    expect(formatAmount("0.30", "USD")).toBe("$0.30");
    expect(formatAmount("9007199254740993.01", "USD")).toContain("9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993.01");
  });
  it("compacts big numbers", () => {
    expect(formatAmount("1500000", "RWF", { compact: true })).toBe("1.5M\u00a0RWF");
    expect(formatAmount("45200.00", "PLN", { compact: true })).toBe("45.2k\u00a0zł");
  });
});

describe("minorToAmount", () => {
  it("is exact for each currency", () => {
    expect(minorToAmount(5, "PLN")).toBe("0.05");
    expect(minorToAmount(-1250, "EUR")).toBe("-12.50");
    expect(minorToAmount(15000, "RWF")).toBe("15000");
  });
});

describe("validateAmountInput", () => {
  it("flags precision the currency cannot hold", () => {
    expect(validateAmountInput("10.5", "RWF")).toMatch(/no decimals/);
    expect(validateAmountInput("1.2345", "PLN")).toMatch(/2 decimals/);
    expect(validateAmountInput("1e3", "PLN")).toMatch(/digits/);
    expect(validateAmountInput("12,50", "PLN")).toBeNull();
  });
});

describe("pct", () => {
  it("renders API fractions", () => {
    expect(pct("0.2501")).toBe("25%");
    expect(pct("1.2000")).toBe("120%");
    expect(pct("0.0000")).toBe("0%");
    expect(pct("0.2501", 1)).toBe("25.0%");
  });
});
