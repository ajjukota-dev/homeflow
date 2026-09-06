import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 05-journey-templates.md Screens: "Journey Template Studio" — targeted spec for this new
// surface at 3 breakpoints, not the full suite (this session's standing per-slice guidance).
// Default storageState (playwright.config.ts) is superadmin; the app's default project is East
// Crest, whose journey template has a real published version seeded by demo-east-crest.ts.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function openStudio(page: import("@playwright/test").Page) {
  await page.goto("/");
  // nav.ts gives every item a `short` label used below the sidebar's collapse breakpoint
  // ("Studio" at mobile widths, not "Policy Studio") — match either (found via the mobile
  // screenshot test timing out on the full label before this fix).
  await page.getByRole("button", { name: /Studio/ }).first().click();
  await page.getByRole("button", { name: "Journey Template Studio" }).click();
  await expect(page.getByRole("heading", { name: "Journey Template Studio" })).toBeVisible();
  // Real content, not the loading Skeleton — same "wait for settled content" discipline as
  // myday.spec.ts / queues.spec.ts (a container being visible mid-fetch is not the same as
  // the version's stages having loaded).
  await expect(page.getByRole("heading", { name: "Commercial" })).toBeVisible();
}

for (const s of sizes) {
  test(`Journey Template Studio @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openStudio(page);
    await page.screenshot({ path: shot(`journey-template-studio-${s.name}`), fullPage: true });
  });
}

test("Journey Template Studio: preview dialog runs against the real seeded template", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio(page);

  await page.getByRole("button", { name: "Preview" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Run preview" }).click();
  // BOOKING is unconditional in every seeded template, so it always instantiates.
  await expect(dialog.getByText(/BOOKING/)).toBeVisible();
  // Two "Close" buttons: the header's icon-close (aria-label) and this dialog's own footer
  // button (visible text) — both compute the same accessible name, so `.last()` disambiguates
  // rather than a bare name match (found via a strict-mode-violation error, not guessed).
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toHaveCount(0);
});

test("Journey Template Studio: a DRAFT version exposes edit affordances a PUBLISHED one hides", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio(page);

  const versionSelect = page.getByRole("combobox", { name: "Version" });
  const versionLabel = await versionSelect.textContent();
  if (versionLabel?.includes("PUBLISHED")) {
    // Read-only assertion for a PUBLISHED version — editing it would mutate the shared dev DB's
    // template beyond what this test owns (unlike Queues' claim/reassign, a version's status is
    // not reversible from the UI). Draft-path editing itself is covered by RTL mocks.
    await expect(page.getByText(/Only a DRAFT version can be edited/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add stage" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Add stage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  }
});
