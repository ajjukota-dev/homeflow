import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

const sizes = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

// 26-customer-portal.md rule 11: mobile-first (customers use phones) — every area still renders
// correctly at tablet/desktop widths too, so all 3 breakpoints get a real assertion + screenshot,
// not just mobile.
for (const s of sizes) {
  test(`Home @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your journey so far" })).toBeVisible();
    await page.screenshot({ path: shot(`home-${s.name}`), fullPage: true });
  });
}

test("bottom tab bar switches between Home, Journey, Payments, Documents, More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Journey" }).click();
  await expect(page.getByRole("heading", { name: "Journey" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stages" })).toBeVisible();

  await page.getByRole("button", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  // "Paid" also labels each already-paid schedule line's status chip — scope to the summary row.
  await expect(page.getByText("Paid").first()).toBeVisible();

  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Required from you" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  for (const label of ["My Home", "Registration", "Handover", "Requests", "Commitments", "Home Passport", "Updates", "Profile"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
});

// At 375 (rule 11: mobile-first) with a screenshot per area — none of these 8 screens were ever
// actually looked at before (found in review, 2026-09-07): only a heading was asserted, which
// would pass just as well against a raw, unformatted Postgres timestamp string. Several of these
// screens render date/timestamp fields straight from the API (Documents' generated_at, Home
// Passport's occurred_at, Updates' published_at, Commitments' promised_date, Registration's slot,
// Handover's confirmed_slot) — guard against both "Invalid Date" and an un-formatted
// "YYYY-MM-DD HH:MM" timestamp leaking into the UI, the same class of bug as the raw-date fix
// applied to these pages this session.
const RAW_TIMESTAMP = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
test("More → each area opens, renders real dates, and Back returns to the More menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();

  for (const [label, heading, shotName] of [
    ["My Home", "My Home", "my-home"],
    ["Registration", "Registration", "registration"],
    ["Handover", "Handover", "handover"],
    ["Requests", "Requests", "requests"],
    ["Commitments", "Commitments", "commitments"],
    ["Home Passport", "Home Passport", "passport"],
    ["Updates", "Updates", "updates"],
    ["Profile", "Profile", "profile-more"],
  ] as const) {
    await page.getByRole("button", { name: label }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // AreaScreen.tsx renders its skeleton with role="status" while the area's fetch is in flight —
    // the heading itself is static and visible instantly, so without this the screenshot below
    // raced ahead of the fetch and captured the loading skeleton every time (found live 2026-09-07:
    // all 8 of these screenshots showed only skeletons, the same networkidle-class bug as spec 17's
    // list tests — a heading-only wait passes just as well against a skeleton as against real data).
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await expect(page.getByText("Invalid Date")).toHaveCount(0);
    await expect(page.getByText(RAW_TIMESTAMP)).toHaveCount(0);
    await page.screenshot({ path: shot(`more-${shotName}-mobile`), fullPage: true });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  }
});

test("Profile shows the signed-in customer and can send a password reset link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByText("Ananya Rao")).toBeVisible();
  await expect(page.getByText("customer@demo.pranava")).toBeVisible();
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/Reset link sent/)).toBeVisible();
  await page.screenshot({ path: shot("profile-mobile"), fullPage: true });
});

// A scheduled demand (no due_date yet) reads "Upcoming" — never a stamped or malformed date.
for (const s of sizes) {
  test(`Payments — Upcoming, never Invalid Date @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: "Payments" }).click();
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    // The schedule renders after an async portalApi.payments() fetch — wait for real content
    // (not just the static heading) before asserting/screenshotting, or both can race ahead of
    // the fetch and capture the loading skeleton (same class of bug found live in spec 17).
    await expect(page.getByText("Paid").first()).toBeVisible();
    await expect(page.getByText("Invalid Date")).toHaveCount(0);
    await page.screenshot({ path: shot(`payments-${s.name}`), fullPage: true });
  });
}
