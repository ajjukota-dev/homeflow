import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * Visual + console checks at the three breakpoints CLAUDE.md requires.
 * Run against `npm run dev` (Vite on :5173, proxying to the compose stack).
 *
 * The v1 page shots need the v1 Mongo routers running — see the report for the
 * throwaway-Mongo recipe. They skip cleanly when the API is not serving them.
 */
const BREAKPOINTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

/**
 * Fails the test on any console error, per technical/09 §8 ("zero console errors").
 *
 * The browser logs a `Failed to load resource` line for every non-2xx response,
 * including the `GET /me/session` 401 that is the whole point of a sign-in
 * screen. Those are network status lines, not application errors, so they are
 * filtered; uncaught exceptions and `console.error` calls are not.
 */
const EXPECTED_UNAUTH = /Failed to load resource.*40[13]/;

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && !EXPECTED_UNAUTH.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("workspace sign-in", () => {
  for (const bp of BREAKPOINTS) {
    test(`sign-in @ ${bp.name}`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto("/login");

      await expect(page.getByRole("heading", { level: 1, name: "Sign in to HomeFlow" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
      // No password field exists anywhere in HomeFlow 2.0 (technical/03).
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      // One h1 per page.
      await expect(page.locator("h1")).toHaveCount(1);

      await page.screenshot({ path: shot(`signin-${bp.name}`), fullPage: true });
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }

  test("dev login lists the seeded staff and points at the API, not a broker", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    const list = page.getByTestId("signin-devlist");
    await expect(list).toBeVisible();
    await expect(list.getByText("Aarti Rao")).toBeVisible();
    const google = page.getByRole("button", { name: /Continue with Google/ });
    await expect(google).toBeVisible();
    // v1 left for auth.emergentagent.com; 2.0 never does.
    expect(await page.content()).not.toContain("emergentagent");
  });
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const res = await page.request.get(
      `${baseURL}/auth/dev-login?user=aarti.rao@pranava.local`,
      { maxRedirects: 0 },
    );
    expect([302, 303, 307]).toContain(res.status());
  });

  for (const bp of BREAKPOINTS) {
    test(`dashboard @ ${bp.name}`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto("/dashboard");
      // Not `networkidle`: v1's pages poll, and the shell is what this asserts.
      // The sidebar renders from /me/permissions, which needs no v1 storage.
      await expect(page.getByTestId("app-sidebar").or(page.getByTestId("portal-unavailable"))).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
      // Best effort: the body renders from v1's Mongo-backed routers, which are
      // absent in CI. With them running the screenshot shows the real page;
      // without them it shows the shell, and either way the test stands.
      await page
        .getByText(/Loading exec dashboard/i)
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
      await page.screenshot({ path: shot(`dashboard-${bp.name}`), fullPage: true });
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }

  /**
   * v1's pages read Mongo-backed routers. They are exercised when the stack runs
   * with HOMEFLOW_V1_MONGO=1 and skipped otherwise, so CI (which has no Mongo,
   * by design — it is being removed) stays green while a developer with the
   * throwaway Mongo running still gets the real page shot.
   */
  test("customer 360 @ 1440", async ({ page, baseURL }) => {
    const list = await page.request.get(`${baseURL}/api/customers?limit=1`).catch(() => null);
    test.skip(!list?.ok(), "v1 Mongo routers are not running (set HOMEFLOW_V1_MONGO=1)");
    const body = await list!.json();
    const first = Array.isArray(body) ? body[0] : (body.items ?? body.data ?? [])[0];
    test.skip(!first?.id, "no seeded customer to open");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/customers/${first.id}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: shot("customer360-1440"), fullPage: true });
  });
});

test("no page scrolls sideways at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
