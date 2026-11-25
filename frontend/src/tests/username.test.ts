import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeUsername, USERNAME_HINT, USERNAME_PATTERN } from "@/lib/username";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const pattern = new RegExp(`^${USERNAME_PATTERN}$`);

describe("normalizeUsername", () => {
  it("lowercases and trims so a phone autocapitalizing the first letter still submits", () => {
    expect(normalizeUsername("Ateck")).toBe("ateck");
    expect(normalizeUsername("  King_Whisper ")).toBe("king_whisper");
    expect(normalizeUsername("ada")).toBe("ada");
  });

  it("accepts mixed case against the form pattern after normalizing", () => {
    expect(pattern.test(normalizeUsername("Ateck"))).toBe(true);
    expect(pattern.test("Ateck")).toBe(true); // pattern itself is case-insensitive on the first letter
    expect(pattern.test("1ateck")).toBe(false);
    expect(pattern.test("ab")).toBe(false);
    expect(pattern.test("ada-lovelace")).toBe(false);
  });
});

describe("setup and signup username fields", () => {
  for (const rel of ["app/(auth)/setup/page.tsx", "app/(auth)/signup/page.tsx"]) {
    it(`${rel} lowercases input, disables autocapitalize, and shows the rule instead of a lowercase-only pattern`, () => {
      const page = read(rel);
      expect(page).toContain("normalizeUsername");
      expect(page).toContain("USERNAME_FIELD");
      expect(page).toContain("USERNAME_HINT");
      expect(page).toContain("onInvalid");
      expect(page).not.toMatch(/pattern="\[a-z\]\[a-z0-9_\]\{2,31\}"/);
    });
  }

  it("exposes a visible hint, not only the native title tooltip", () => {
    expect(read("app/(auth)/setup/page.tsx")).toContain("{USERNAME_HINT}");
    expect(USERNAME_HINT.toLowerCase()).toContain("lowercased");
  });
});

describe("setup config errors", () => {
  it("does not treat a failed config fetch as owner setup already being used", () => {
    const page = read("app/(auth)/setup/page.tsx");
    expect(page).toContain("configError");
    expect(page).toMatch(/Can.?t reach the server/);
    expect(page).toMatch(/waking up/);
    expect(page).not.toMatch(/catch\(\(\) => setAvailable\(false\)\)/);
  });
});
