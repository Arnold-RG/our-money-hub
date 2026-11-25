import { expect, test, type Page } from "@playwright/test";

const OUT = process.env.OMH_SHOTS_DIR ?? "/workspace/arnova-v2/screenshots-v2/omh";

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

test("style v2 shots", async ({ page }) => {
  test.skip(!process.env.STYLE_SHOTS && !process.env.SCREENSHOTS, "set STYLE_SHOTS=1");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /welcome back|create your hub/i })).toBeVisible();
  await page.getByRole("button", { name: /explore a private demo/i }).click();
  await page.waitForURL("**/dashboard");
  await ready(page);

  await setTheme(page, "dark");
  await page.reload();
  await ready(page);
  await page.screenshot({ path: `${OUT}/desktop-dashboard-dark.png`, fullPage: true });

  await setTheme(page, "light");
  await page.reload();
  await ready(page);
  await page.screenshot({ path: `${OUT}/desktop-dashboard-light.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await page.reload();
  await ready(page);
  await page.screenshot({ path: `${OUT}/phone-dashboard-dark.png` });

  await setTheme(page, "light");
  await page.reload();
  await ready(page);
  await page.screenshot({ path: `${OUT}/phone-dashboard-light.png` });
});
