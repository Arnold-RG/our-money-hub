import { describe, expect, it } from "vitest";
import { DEV_RAGI_URL, PRODUCTION_RAGI_URL, ragiPublicUrl } from "../lib/ecosystem-urls";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ragiPublicUrl", () => {
  it("never falls back to localhost in production", () => {
    expect(ragiPublicUrl({ NODE_ENV: "production" })).toBe(PRODUCTION_RAGI_URL);
    expect(ragiPublicUrl({ NODE_ENV: "production" })).not.toMatch(/localhost/);
  });

  it("uses localhost only in development when unset", () => {
    expect(ragiPublicUrl({ NODE_ENV: "development" })).toBe(DEV_RAGI_URL);
  });
});

describe("shell switcher", () => {
  it("links back to RAGI", () => {
    const shell = readFileSync(resolve(import.meta.dirname, "../components/layout/shell.tsx"), "utf8");
    expect(shell).toContain("EcosystemSwitcher");
    const sw = readFileSync(resolve(import.meta.dirname, "../components/layout/EcosystemSwitcher.tsx"), "utf8");
    expect(sw).toContain("ragiPublicUrl");
    expect(sw).toContain("RAGI");
  });
});
