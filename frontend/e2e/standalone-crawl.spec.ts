import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const OMH = process.env.OMH_WEB_URL ?? "http://localhost:3420";
const ROUTES = [
  "/login",
  "/unlock",
  "/dashboard",
  "/transactions",
  "/budgets",
  "/accounts",
  "/subscriptions",
  "/reports",
  "/future-projects",
  "/my-finances",
  "/settings",
  "/more",
  "/ai",
];
const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1280, height: 800, isMobile: false },
] as const;

function sessionCookie() {
  const file = process.env.OMH_SESSION_COOKIE_FILE ?? "/workspace/arnova-v2/runtime/omh-session.cookie";
  if (!existsSync(file)) return null;
  const value = readFileSync(file, "utf8").trim();
  if (!value) return null;
  return { name: "__Host-omh_session", value, domain: "localhost", path: "/", httpOnly: true, secure: true as const, sameSite: "Lax" as const };
}

async function assertClean(page: Page, errors: string[]) {
  const box = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(box.sw, `overflow ${box.sw} > ${box.cw} at ${page.url()}`).toBeLessThanOrEqual(box.cw);
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => ({
      href: (a as HTMLAnchorElement).getAttribute("href") || "",
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    })).filter((x) => /arnova-ragi|localhost:3411|Open RAGI/i.test(`${x.href} ${x.text}`)),
  );
  expect(bad, `cross-app or Open RAGI link at ${page.url()}`).toEqual([]);
  expect(errors, `console errors at ${page.url()}`).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test(`crawl at ${vp.name}: no overflow, no RAGI links, no console errors`, async ({ browser }) => {
    const cookie = sessionCookie();
    test.skip(!cookie && vp.name !== "ignore", "no local OMH session cookie");
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile });
    if (cookie) await ctx.addCookies([cookie]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    const ignorable = (text: string) =>
      /Failed to load resource: the server responded with a status of 401/.test(text);
    page.on("pageerror", (err) => {
      if (!ignorable(String(err))) errors.push(String(err));
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && !ignorable(msg.text())) errors.push(msg.text());
    });
    for (const route of ROUTES) {
      errors.length = 0;
      if (route !== "/login" && !cookie) continue;
      const res = await page.goto(`${OMH}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(600);
      if (route !== "/login" && route !== "/unlock") expect(page.url()).not.toMatch(/\/login/);
      expect(res?.ok() || res?.status() === 304, `bad status ${res?.status()} at ${route}`).toBeTruthy();
      await assertClean(page, [...errors]);
      if (route === "/login" && vp.name === "390") {
        await page.screenshot({ path: "/workspace/arnova-v2/screenshots/mobile/after-omh-login-390.png", fullPage: false });
      }
    }
    await ctx.close();
  });
}
