import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Walks the real app (demo login = a private, empty workspace) and saves screenshots.
 * Empty states first. Then a few entries are added through the UI's own API, every one
 * labelled "Test …" so no screenshot can be mistaken for real figures.
 */
const OUT = process.env.OMH_SHOTS_DIR || path.resolve(__dirname, "../../screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => {
    localStorage.setItem("omh.theme", t);
    document.documentElement.dataset.theme = t;
  }, theme);
}

async function apiCall(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const ws = localStorage.getItem("omh.ws");
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: { "Content-Type": "application/json", "X-OMH-Client": "web", ...(ws ? { "X-Workspace-Id": ws } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
      return r.json();
    },
    { method, url, body },
  );
}

for (const vp of VIEWPORTS) {
  test(`screens ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back|create your hub/i })).toBeVisible();
    await shot(page, `${vp.name}-login-dark`);
    await setTheme(page, "light");
    await page.reload();
    await shot(page, `${vp.name}-login-light`);
    await setTheme(page, "dark");
    await page.reload();

    await page.getByRole("button", { name: /explore a private demo/i }).click();
    await page.waitForURL("**/dashboard");
    // Pin the workspace so API helper calls target the same books as the UI.
    const me = await apiCall(page, "GET", "/auth/me");
    const personal = me.workspaces.find((w: { kind: string }) => w.kind === "personal");
    await page.evaluate((id) => localStorage.setItem("omh.ws", id), personal.id);
    await page.reload();
    await expect(page.getByText(/your hub is empty and honest/i)).toBeVisible();
    await shot(page, `${vp.name}-dashboard-empty-dark`);
    await setTheme(page, "light");
    await shot(page, `${vp.name}-dashboard-empty-light`);
    await setTheme(page, "dark");

    for (const p of ["accounts", "transactions", "budgets", "subscriptions", "ai", "reports", "settings"]) {
      await page.goto(`/${p}`);
      await shot(page, `${vp.name}-${p}-empty-dark`);
    }
    if (vp.name === "mobile") {
      await page.goto("/more");
      await shot(page, `mobile-more-dark`);
    }

    // Add clearly labelled test entries through the UI flow for one, the API for the rest.
    await page.goto("/accounts");
    await page.getByRole("button", { name: /add (your first )?account/i }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Account name").fill("Test bank account");
    await dlg.getByLabel("Opening balance").fill("1000.00");
    await dlg.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText("Test bank account")).toBeVisible();

    const accs = await apiCall(page, "GET", "/accounts");
    const bank = accs[0];
    const wallet = await apiCall(page, "POST", "/accounts", { name: "Test mobile money wallet", kind: "mobile_money", currency: "RWF", opening_balance: "100000" });
    const cats = await apiCall(page, "GET", "/categories");
    const cat = (n: string) => cats.find((c: { name: string }) => c.name === n)?.id ?? null;
    const today = new Date().toISOString().slice(0, 10);
    await apiCall(page, "POST", "/transactions", { kind: "income", account_id: bank.id, amount: "500.00", currency: "PLN", date: today, description: "Test income" });
    await apiCall(page, "POST", "/transactions", { kind: "expense", account_id: bank.id, amount: "120.00", currency: "PLN", date: today, description: "Test expense", category_id: cat("Food & groceries") });
    await apiCall(page, "POST", "/transactions", { kind: "expense", account_id: wallet.id, amount: "5000", currency: "RWF", date: today, description: "Test mobile payment", category_id: cat("Transport") });
    await apiCall(page, "POST", "/budgets", { name: "Test budget", scope: "category", category_id: cat("Food & groceries"), amount: "400.00", currency: "PLN" });
    await apiCall(page, "POST", "/budgets", { name: "Test AI guard", scope: "ai", amount: "20.00", currency: "USD", hard_limit: true });
    const next = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    await apiCall(page, "POST", "/subscriptions", { name: "Test AI plan", vendor: "Test vendor", kind: "ai", amount: "80.00", currency: "PLN", interval: "monthly", next_renewal: next, account_id: bank.id });

    for (const p of ["dashboard", "accounts", "transactions", "budgets", "subscriptions", "ai", "reports"]) {
      await page.goto(`/${p}`);
      await shot(page, `${vp.name}-${p}-testdata-dark`);
    }
    await setTheme(page, "light");
    for (const p of ["dashboard", "transactions", "budgets"]) {
      await page.goto(`/${p}`);
      await shot(page, `${vp.name}-${p}-testdata-light`);
    }
    await setTheme(page, "dark");

    // Command palette + a dialog (focus trap) for the record.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: /search and commands/i })).toBeVisible();
    await page.keyboard.type("test");
    await shot(page, `${vp.name}-command-palette-dark`);
    await page.keyboard.press("Escape");
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add payment" }).first().click();
    await expect(page.getByRole("dialog", { name: "New payment" })).toBeVisible();
    await shot(page, `${vp.name}-add-payment-dark`);
    // Focus never leaves the dialog.
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  });
}
