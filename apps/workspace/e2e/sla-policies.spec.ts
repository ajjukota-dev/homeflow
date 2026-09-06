import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 06-timeline-sla-engine.md Screens: "SLA policies" (Policy Studio tab) — targeted spec for this
// new surface at 3 breakpoints, not the full suite. Default storageState is superadmin, which
// has real seeded sla_policy rows (customer_query_response, warranty response clocks, T1-T13/
// PT1-PT6 per-task policies from journey-standard.ts).
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function openSlaPolicies(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Studio/ }).first().click();
  await page.getByRole("button", { name: "SLA policies" }).click();
  await expect(page.getByRole("heading", { name: "SLA policies" })).toBeVisible();
  // Real content, not the loading Skeleton — same discipline as myday.spec.ts/queues.spec.ts.
  await expect(page.getByRole("cell", { name: "customer_query_response", exact: true })).toBeVisible();
}

for (const s of sizes) {
  test(`SLA policies @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openSlaPolicies(page);
    await page.screenshot({ path: shot(`sla-policies-${s.name}`), fullPage: true });
  });
}

test("SLA policies: editing a real policy shows a genuine open-clock impact preview before publish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSlaPolicies(page);

  await page
    .getByRole("row", { name: /customer_query_response/ })
    .getByRole("button", { name: "Edit" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
  // Whichever way it resolves, the message is a real count, not a stub — never both/neither.
  await expect(dialog.getByText(/currently open SLA clock|No open SLA clocks currently reference this policy/)).toBeVisible();
  // Read-only here: confirming would mutate this policy's version/effective_from in the shared
  // dev DB (same reasoning journey-template-studio.spec.ts already applied to a PUBLISHED
  // version) — back out instead of publishing.
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("SLA policies: History is honest about seeded rows never having gone through draft/publish", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSlaPolicies(page);

  // Seeded sla_policy rows are inserted directly by seed scripts, not via
  // draftStudioRow/publishStudioRow — policy_version genuinely has no rows for them yet. The
  // honest empty state, not a fabricated "v1" entry, is the correct assertion here. Uses
  // warranty_minor (seed/post-handover.ts), not customer_query_response — the previous test's
  // "Continue" already stages (but never publishes) a real draft policy_version row for that one,
  // and this file's tests share one dev DB, so a row another test has touched isn't a safe fixture
  // for "never touched" here.
  await page.getByRole("button", { name: /History for warranty_minor/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No changes recorded for this row yet.")).toBeVisible();
});
