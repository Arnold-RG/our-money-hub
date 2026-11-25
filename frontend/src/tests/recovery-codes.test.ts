import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("Settings recovery codes card", () => {
  const page = read("app/(finance)/settings/page.tsx");

  it("shows remaining codes and a regenerate form in the security section", () => {
    expect(page).toContain("<RecoveryCodesCard />");
    expect(page).toContain("New recovery codes");
    expect(page).toMatch(/of 10 left/);
    expect(page).toContain("/auth/mfa/recovery-codes/regenerate");
    expect(page).toContain("Get new codes");
  });

  it("asks for the current password and a 6-digit authenticator code", () => {
    expect(page).toContain('type="password"');
    expect(page).toContain('autoComplete="current-password"');
    expect(page).toContain('inputMode="numeric"');
    expect(page).toContain('autoCapitalize="none"');
    expect(page).toContain('autoComplete="one-time-code"');
    expect(page).toContain('maxLength={6}');
  });

  it("shows the new codes once with copy, download, and an old-codes warning", () => {
    expect(page).toMatch(/Old codes no longer work/i);
    expect(page).toContain("Copy all");
    expect(page).toContain("Download .txt");
    expect(page).toContain("our-money-hub-recovery-codes.txt");
  });
});
