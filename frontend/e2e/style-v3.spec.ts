import { expect, test, type Page } from "@playwright/test";

const OUT = process.env.OMH_SHOTS_DIR ?? "/workspace/arnova-v2/screenshots-v3/omh";

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => {
    localStorage.setItem("omh.theme", t);
    document.documentElement.dataset.theme = t;
  }, theme);
}

async function ready(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
}

async function shot(page: Page, name: string, fullPage = true) {
  await ready(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

test.describe("public auth shots", () => {
  test("login signup setup mfa", async ({ page }) => {
    test.skip(!process.env.STYLE_SHOTS && !process.env.SCREENSHOTS, "set STYLE_SHOTS=1");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const theme of ["dark", "light"] as const) {
      await page.goto("/login");
      await setTheme(page, theme);
      await page.reload();
      await shot(page, `desktop-login-${theme}`);

      await page.goto("/signup");
      await setTheme(page, theme);
      await page.reload();
      await shot(page, `desktop-signup-closed-${theme}`);

      await page.goto("/setup");
      await setTheme(page, theme);
      await page.reload();
      await shot(page, `desktop-setup-${theme}`);

      await page.goto("/verify");
      await setTheme(page, theme);
      await page.reload();
      await shot(page, `desktop-mfa-${theme}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await setTheme(page, "dark");
    await page.reload();
    await shot(page, "phone-login-dark", false);
  });
});

test.describe("demo workspace shots", () => {
  test("finances budgets fx", async ({ page }) => {
    test.skip(!process.env.STYLE_SHOTS && !process.env.SCREENSHOTS, "set STYLE_SHOTS=1");
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in to our money hub|welcome back/i })).toBeVisible();
    const demo = page.getByRole("button", { name: /explore a private demo/i });
    await demo.click();
    await page.waitForURL("**/dashboard");
    await ready(page);

    const pages = [
      ["/dashboard", "dashboard"],
      ["/my-finances", "my-finances"],
      ["/future-projects", "future-projects"],
      ["/budgets", "budgets"],
    ] as const;

    for (const theme of ["dark", "light"] as const) {
      for (const [path, name] of pages) {
        await page.goto(path);
        await setTheme(page, theme);
        await page.reload();
        await shot(page, `desktop-${name}-${theme}`);
      }
    }

    // FX switcher open
    await page.goto("/my-finances");
    await setTheme(page, "dark");
    await page.reload();
    await ready(page);
    await page.getByRole("button", { name: /reporting currency/i }).click();
    await page.waitForTimeout(400);
    await shot(page, "desktop-fx-switcher-dark");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my-finances");
    await setTheme(page, "dark");
    await page.reload();
    await shot(page, "phone-my-finances-dark", false);
    await page.goto("/budgets");
    await ready(page);
    await shot(page, "phone-budgets-dark", false);
  });
});
