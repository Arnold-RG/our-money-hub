import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OTP_QR_OPTIONS, otpauthQrSvg } from "@/lib/otpQr";

const root = resolve(import.meta.dirname, "../");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const DUMMY = "otpauth://totp/Our%20Money%20Hub:demo@example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Our%20Money%20Hub";

describe("otpauth QR", () => {
  it("uses a large module size and a light quiet zone", () => {
    expect(OTP_QR_OPTIONS.width).toBeGreaterThanOrEqual(256);
    expect(OTP_QR_OPTIONS.margin).toBeGreaterThanOrEqual(4);
    expect(OTP_QR_OPTIONS.color.light.toLowerCase()).toBe("#ffffff");
  });

  it("renders the otpauth URI as SVG and rejects non-otpauth values", async () => {
    const svg = await otpauthQrSvg(DUMMY);
    expect(svg).toMatch(/<svg/i);
    expect(svg).toMatch(/viewBox/i);
    await expect(otpauthQrSvg("https://example.invalid")).rejects.toThrow(/otpauth/i);
  });
});

describe("authenticator enrolment", () => {
  it("renders a QR from the otpauth URI and keeps the text key as a fallback", () => {
    const page = read("app/(auth)/verify/page.tsx");
    expect(page).toContain("AuthenticatorQr");
    expect(page).toContain("otpauth_uri");
    expect(page).toContain("setup.secret");
    expect(page).toMatch(/Can.?t scan|Enter this key|Add this key/i);
  });

  it("hides the setup token field when the fragment already prefilled it", () => {
    const page = read("app/(auth)/setup/page.tsx");
    expect(page).toContain("useSecretFromFragment");
    expect(page).toMatch(/token\.length\s*>=\s*32|prefilled/);
    expect(page).toMatch(/hide|hidden|!prefilled|prefilled &&/);
  });
});
