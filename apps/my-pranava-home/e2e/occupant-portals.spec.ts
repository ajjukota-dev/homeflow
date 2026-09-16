import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 5.2: portal click-path for Ananya (customer@) and Rohan (rohan@). Read-only — no booking.
// Denylist: no vendor price, internal note, or unapproved forecast (p31 §26 / p18 §11).
test.use({ storageState: { cookies: [], origins: [] } });

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

const DENY = /TRUE_RISK|vendor_cost|internal_note|forecast_confidence|root_cause/;

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

for (const [who, email, hello, unit] of [
  ["ananya", "customer@demo.pranava", "Hello, Ananya", "V112"],
  ["rohan", "rohan@demo.pranava", "Hello, Rohan", "V113"],
] as const) {
  for (const s of sizes) {
    test(`portal ${who} home @ ${s.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.setViewportSize({ width: s.width, height: s.height });
      await login(page, email, "Demo@2026");
      await expect(page.getByRole("heading", { name: new RegExp(`^${hello}`) })).toBeVisible();
      await expect(page.getByText(unit)).toBeVisible();
      await expect(page.getByText(DENY)).toHaveCount(0);
      await page.screenshot({ path: shot(`portal-${who}-home-${s.name}`), fullPage: true });
      expect(errors, "no pageerror").toEqual([]);
    });
  }
}
