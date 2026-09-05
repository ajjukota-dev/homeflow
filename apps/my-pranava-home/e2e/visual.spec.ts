import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * My Pranava Home visual checks at the three breakpoints CLAUDE.md requires.
 * Run against `npm run dev` (Vite on :5174, proxying to the compose stack).
 *
 * With no session the app shows the OTP sign-in, which is now the front door —
 * the home itself needs `/me/home` (TASKS Vivek 15) and a customer session.
 */
const BREAKPOINTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

/** The 401 from GET /me/session is the point of a sign-in screen, not an error. */
const EXPECTED_UNAUTH = /Failed to load resource.*40[13]/;

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && !EXPECTED_UNAUTH.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

for (const bp of BREAKPOINTS) {
  test(`customer sign-in, phone step @ ${bp.name}`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Sign in to your home" })).toBeVisible();
    await expect(page.getByLabel("Mobile number")).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    // Identity comes from the session, never from a query string.
    expect(page.url()).not.toContain("booking_id");

    await page.screenshot({ path: shot(`signin-phone-${bp.name}`), fullPage: true });
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("customer sign-in, code step @ 375", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByRole("button", { name: "Send code" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page.screenshot({ path: shot("signin-code-375"), fullPage: true });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("customer sign-in, code step @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page.screenshot({ path: shot("signin-code-1440"), fullPage: true });
});

test("no page scrolls sideways at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
