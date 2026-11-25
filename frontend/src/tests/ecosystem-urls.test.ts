import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("standalone shell", () => {
  it("does not link out to RAGI", () => {
    const shell = readFileSync(resolve(import.meta.dirname, "../components/layout/shell.tsx"), "utf8");
    expect(shell).not.toContain("EcosystemSwitcher");
    expect(shell).not.toMatch(/arnova-ragi|NEXT_PUBLIC_RAGI|ragiAppUrl|ragiPublicUrl/);
    const auth = readFileSync(resolve(import.meta.dirname, "../components/auth/AuthShell.tsx"), "utf8");
    expect(auth).not.toMatch(/Open RAGI|ragiPublicUrl|ragiAppUrl|arnova-ragi/);
  });
});
