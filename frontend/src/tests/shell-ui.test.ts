import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("Emerald ledger chrome", () => {
  it("uses a currency dropdown with official rate date, source and stale, never sample rates", () => {
    const shell = read("components/layout/shell.tsx");
    expect(shell).toContain("CurrencyLens");
    expect(shell).toContain('aria-label="Reporting currency"');
    expect(shell).toContain("listbox");
    expect(shell).toContain("SWITCHER_CURRENCIES");
    expect(read("lib/money.ts")).toMatch(/SWITCHER_CURRENCIES[\s\S]*\[\s*"RWF"/);
    expect(shell).toContain("/exchange-rates");
    expect(shell).toContain("effective_date");
    expect(shell).toContain("No official rate on file");
    expect(shell).toContain("We never show sample rates");
    expect(shell).toContain("older than 2 Polish business days");
    expect(shell).not.toMatch(/bg-\[var\(--omh-accent\)\]|filled chip/i);
    expect(shell).not.toMatch(/mid-market|illustrative only/i);
  });

  it("keeps blur only on the phone tab bar, with solid fallbacks", () => {
    const css = read("styles/shell-ui.css");
    expect(css).toMatch(/\.tabbar[\s\S]*backdrop-filter:\s*saturate\(160%\) blur/);
    expect(css).toMatch(/@supports not \(\(backdrop-filter/);
    expect(css).toMatch(/prefers-reduced-transparency/);
    const values = [...css.matchAll(/backdrop-filter:\s*([^;]+)/g)].map((m) => m[1].trim());
    expect(values.some((v) => v.includes("blur"))).toBe(true);
    expect(values.every((v) => v === "none" || v.includes("blur"))).toBe(true);
  });

  it("ships KPI cards, budget warning fill, and a filter save action", () => {
    expect(read("components/ui/KpiCard.tsx")).toMatch(/hero \? "hero"/);
    expect(read("components/ui/Sparkline.tsx")).toContain('role="img"');
    expect(read("components/ui/FilterBar.tsx")).toContain("Save this view");
    expect(read("components/ui/index.tsx")).toContain("var(--bar-warning)");
  });

  it("hides leftover aurora and glass blobs", () => {
    const g = read("app/globals.css");
    expect(g).toMatch(/\.aurora,\s*\.grid-bg\s*\{\s*display:\s*none/);
    expect(g.toLowerCase()).not.toMatch(/box-shadow:\s*[^;]*0 0 \d+px/);
  });
});
