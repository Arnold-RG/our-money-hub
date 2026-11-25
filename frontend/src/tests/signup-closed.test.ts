import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("closed-mode account creation UI", () => {
  it("always shows a Create account link to /signup on the login page", () => {
    const login = read("app/(auth)/login/page.tsx");
    expect(login).toContain('href="/signup"');
    expect(login).toContain("Create account");
    expect(login).not.toMatch(/signup_enabled\s*\?[\s\S]*Create account[\s\S]*This app is private/);
  });

  it("shows the username, email and password form disabled when sign-up is closed", () => {
    const page = read("app/(auth)/signup/page.tsx");
    expect(page).toContain('htmlFor="username"');
    expect(page).toContain('htmlFor="email"');
    expect(page).toContain('htmlFor="password"');
    expect(page).toContain("Sign-ups are off because this app is private.");
    expect(page).toContain("<fieldset disabled={closed}");
    expect(page).toContain("disabled={closed || busy}");
    expect(page).toMatch(/id="username"[\s\S]*disabled=\{closed\}/);
    expect(page).toMatch(/id="email"[\s\S]*disabled=\{closed\}/);
    expect(page).toMatch(/id="password"[\s\S]*disabled=\{closed\}/);
    expect(page).not.toMatch(/Sign-up is disabled\./);
  });
});
