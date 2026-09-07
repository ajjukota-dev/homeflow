import { test, expect } from "@playwright/test";

// 16-handover-gates.md — stateful handover case machine UI (pipeline + case drawer). Runs against
// the same shared dev DB as visual.spec.ts's QA tests. This file only reads/overrides gates on
// V110 — never eligible (Physical is blocked by real readiness/utilities and can't be overridden),
// so nothing here races another file into completing it. V112 is visual.spec.ts's own full
// eligible→appointment→checklist→signatures→complete flow; V113 was tried here first but dropped
// after a full-suite run showed it flaking — commitments.spec.ts's own gate-integration test opens
// a temporary commitment against `handovers[0]` (whichever booking the pipeline returns first, not
// pinned to a villa), so any shared booking can transiently gain/lose an open commitment mid-run.

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

const sizes = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "tablet", width: 768, height: 1200 },
  { name: "mobile", width: 375, height: 1400 },
];

for (const s of sizes) {
  test(`Handover pipeline lists every active booking with real gate chips @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^QA/ }).first().click();
    await expect(page.getByRole("heading", { name: "Handover gates" })).toBeVisible();
    // Both names also appear in the Unit readiness section above — .last() picks the
    // Handover gates row, which renders later in the DOM.
    await expect(page.getByText("Karthik Iyer · Villa V110").last()).toBeVisible();
    await expect(page.getByText("Rohan Desai · Villa V113").last()).toBeVisible();
    await page.screenshot({ path: shot(`handover-pipeline-${s.name}`), fullPage: true });

    // Read-only pass through the case drawer at this breakpoint (no gate mutation here —
    // the override flows below run desktop-only so they don't collide with this loop).
    const openCase = page
      .locator("main")
      .getByText("Karthik Iyer · Villa V110", { exact: true })
      .last()
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
      .getByRole("button", { name: "Open case" });
    await openCase.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Gates" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Digital checklist" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: shot(`handover-case-drawer-${s.name}`), fullPage: true });
  });
}

test("Case drawer shows all eight gates and overrides one that requires an approver", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();

  const openCase = page
    .locator("main")
    .getByText("Karthik Iyer · Villa V110", { exact: true })
    .last()
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
    .getByRole("button", { name: "Open case" });
  await openCase.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Not eligible yet")).toBeVisible();

  // 6 hard gates (Financial, Legal, Registration, Physical, Quality, Commitments) + 2 soft
  // (Customer, FM/Community) — the full eight-gate set from 16-handover-gates.md's config.
  await expect(dialog.getByText("Hard", { exact: true })).toHaveCount(6);
  await expect(dialog.getByText("Soft", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("Required consideration not received to the registration threshold")).toBeVisible();
  await expect(dialog.getByText("Cannot be overridden.")).toBeVisible(); // Physical — not overridable
  await page.screenshot({ path: shot("handover-case-gates"), fullPage: true });

  const financialCard = dialog.getByText("Financial clearance", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await financialCard.getByRole("button", { name: "Override" }).click();

  const overrideDialog = page.getByRole("dialog").filter({ hasText: "Override Financial clearance" });
  await expect(overrideDialog.getByText("Approver")).toBeVisible(); // FINANCIAL requires_approval
  await overrideDialog.getByLabel("Reason").fill("Customer paid via bank transfer, receipt pending reconciliation.");
  await overrideDialog.getByLabel(/Approver/).fill("user_management");
  await page.screenshot({ path: shot("handover-override-dialog"), fullPage: true });
  await overrideDialog.getByRole("button", { name: "Confirm override" }).click();

  await expect(financialCard.getByText("Overridden")).toBeVisible();
  await expect(financialCard.getByRole("button", { name: "Override" })).toHaveCount(0);
});

test("Overriding a gate that requires evidence rejects an empty evidence field, then accepts one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();

  const openCase = page
    .locator("main")
    .getByText("Karthik Iyer · Villa V110", { exact: true })
    .last()
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
    .getByRole("button", { name: "Open case" });
  await openCase.click();

  const dialog = page.getByRole("dialog");
  const qualityCard = dialog.getByText("Quality", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await qualityCard.getByRole("button", { name: "Override" }).click();

  const overrideDialog = page.getByRole("dialog").filter({ hasText: "Override Quality" });
  await expect(overrideDialog.getByText("Evidence reference(s)")).toBeVisible(); // QUALITY requires_evidence
  await overrideDialog.getByLabel("Reason").fill("Snags are cosmetic only; site engineer signed off ahead of the formal QA pass.");
  await overrideDialog.getByRole("button", { name: "Confirm override" }).click();
  await expect(overrideDialog.getByText("Evidence is required for this gate.")).toBeVisible();

  await overrideDialog.getByLabel("Evidence reference(s)").fill("site walkthrough photos, engineer sign-off note");
  await overrideDialog.getByRole("button", { name: "Confirm override" }).click();

  await expect(qualityCard.getByText("Overridden")).toBeVisible();
  await expect(qualityCard.getByRole("button", { name: "Override" })).toHaveCount(0);
});
