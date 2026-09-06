import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

async function openTower(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Management|Tower/ }).first().click();
  await expect(page.getByRole("heading", { name: "Control tower" })).toBeVisible();
}

// 27-management-control-tower.md Screens: "Control Tower (existing, extended)" + "Views as tabs" —
// Portfolio, Cash (reuses 20), Project Cash Flow (reuses 20), Profitability, Exceptions, KPIs
// (domain tabs + drill), Teams. Project Performance/Experience/Execution are deliberately not
// built (no dedicated backend combines 06/16/07/08's data) — see this spec's Build note.
test("Control tower shows a real rupee impact, not the pre-27 zero placeholder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  // Pins the fix: decision_pack.impact was renamed { inr, customers, days } when spec 27's backend
  // replaced tower-view.ts, but this screen kept reading the old `.rupee` field — every card with
  // real impact silently rendered "No rupee at risk" until this session's fix.
  await expect(page.getByText(/^₹[\d,]+$/).first()).toBeVisible();
});

test("Dismissing an intervention requires a reason and it drops out of the five", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  const dismissButton = page.getByRole("button", { name: "Dismiss" }).first();
  await expect(dismissButton).toBeVisible();
  const headline = await dismissButton
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]")
    .locator("h2")
    .textContent();
  await dismissButton.click();
  await expect(page.getByRole("heading", { name: "Dismiss this intervention" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" }).last()).toBeDisabled();
  await page.getByLabel("Reason (required)").fill("E2E: not material today, confirmed with site");
  await page.getByRole("button", { name: "Dismiss" }).last().click();
  await expect(page.getByRole("heading", { name: "Dismiss this intervention" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: headline! })).toHaveCount(0);
});

test("Portfolio tab lists every project and 'Open' switches the sidebar project selector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  await page.getByRole("tab", { name: "Portfolio" }).click();
  const row = page.getByRole("row", { name: /East Crest/ });
  await expect(row).toBeVisible();
  await page.screenshot({ path: shot("tower-portfolio-desktop"), fullPage: true });

  // "Open" here only switches the project context (stays on this tab) — a different callback
  // wiring than finance/PortfolioCompare's own "Open", which also changes the active view.
  const otherRow = page.getByRole("row", { name: /Pranava Meadows/ });
  await otherRow.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("combobox", { name: "Select project" })).toHaveValue(/.*/);
  await expect(page.getByRole("heading", { name: "Control tower" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Select project" }).locator("option:checked")).toHaveText("Pranava Meadows");
});

test("Cash tab reuses the Portfolio Comparison screen; Project Cash Flow tab reuses the Cash Flow Planner", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  await page.getByRole("tab", { name: "Cash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Portfolio Comparison" })).toBeVisible();
  await page.getByRole("tab", { name: "Project Cash Flow" }).click();
  await expect(page.getByRole("heading", { name: "Cash Flow Planner" })).toBeVisible();
  await expect(page.getByText("Opening outstanding")).toBeVisible();
});

test("Profitability tab shows economic events and per-unit contribution", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // No UI flow raises a snag with a cost (QaHandover.tsx's raise-snag form has no cost field) and no
  // waiver/CR-acceptance UI exists yet, so a fresh DB has zero economic_event rows and this table's
  // populated branch is otherwise untested. Fixture via a direct API call (same pattern as
  // commitments.spec.ts's handover-gate test) — a real snag with a real estimated_cost_inr, which
  // deriveEconomicEvents (management/profitability.ts) turns into a QUALITY_COST row on GET.
  const snagsResp = await page.request.get("/api/snags?project_id=p_eastcrest");
  const existingSnags: { unit_id: string }[] = (await snagsResp.json()).data;
  test.skip(existingSnags.length === 0, "No units with snags seeded in this dev DB.");
  const unitId = existingSnags[0].unit_id;
  const createResp = await page.request.post("/api/snags", {
    data: { unit_id: unitId, room: "KITCHEN", category: "FITTINGS", severity: "MAJOR", description: "E2E fixture: cabinet hinge loose", estimated_cost_inr: 4500 },
  });
  expect(createResp.ok(), `create failed: ${await createResp.text()}`).toBe(true);

  await openTower(page);
  await page.getByRole("tab", { name: "Profitability" }).click();
  await expect(page.getByRole("heading", { name: "Per-unit contribution" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every economic event" })).toBeVisible();
  // Pins both fixes: the real unit_number (not the raw unit_id) in the per-unit table, and a real
  // populated row in "Every economic event" (previously only the empty-state branch was exercised).
  await expect(page.getByText("Quality cost").first()).toBeVisible();
  await expect(page.getByText(/₹4,500/).first()).toBeVisible();
  await expect(page.getByText(unitId)).toHaveCount(0);
  await page.screenshot({ path: shot("tower-profitability-desktop"), fullPage: true });
});

test("Exceptions tab lists a real forecast manual override with an Indian-grouped rupee amount", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Create the fixture this test needs rather than relying on incidental state left by another
  // spec: a real MANUAL_FINANCE_OVERRIDE forecast line, via Collections Forecast's own Override flow.
  await page.goto("/");
  await page.getByRole("button", { name: /^(Collections Forecast|Forecast)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Collections Forecast" })).toBeVisible();
  await page.getByRole("button", { name: "Override" }).first().click();
  await page.getByLabel("Reason (required)").fill("E2E fixture for the Exceptions view");
  await page.getByRole("button", { name: "Save override" }).click();
  await expect(page.getByRole("heading", { name: "Override forecast line" })).toHaveCount(0);

  await openTower(page);
  await page.getByRole("tab", { name: "Exceptions" }).click();
  // Pins the ₹-grouping fix (management/exceptions.ts used a bare .toFixed(0) with no comma
  // grouping, inconsistent with every other ₹ string in this codebase's own en-IN convention).
  await expect(page.getByText(/₹\d{1,2}(,\d{2})*,\d{3}/).first()).toBeVisible();
});

test("KPIs tab: domain tabs switch, a real value renders, and drill shows numerator/denominator + history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  await page.getByRole("tab", { name: "KPIs" }).click();
  await page.getByRole("tab", { name: "Collections" }).click();
  await expect(page.getByText("Collection efficiency %")).toBeVisible();
  await page.screenshot({ path: shot("tower-kpis-desktop"), fullPage: true });

  await page.getByRole("button", { name: "Drill in" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/\d+ \/ \d+/)).toBeVisible();
  await expect(dialog.getByRole("columnheader", { name: "Period" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Teams tab shows department bottlenecks, table not charts (rule 8)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTower(page);
  // A fresh DB may have zero open actions anywhere yet — Act on an intervention first (it links a
  // real MANAGEMENT-owned action, actIntervention's own `owner_role: "MANAGEMENT"`) so this test
  // doesn't depend on incidental state left over by other specs/tests.
  // Scoped to `main` + exact: a bare substring match on "Act" also matches the sidebar's own nav
  // buttons ("Queues... actions", "...forecast-to-actual", "Actual vs forecast...") — the same bug
  // this session traced as the real cause of visual.spec.ts's long-documented H11 "flake".
  await page.locator("main").getByRole("button", { name: "Act", exact: true }).first().click();
  await expect(page.getByText(/Acted ·/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Teams" }).click();
  await expect(page.getByRole("columnheader", { name: "Median age" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "MANAGEMENT" })).toBeVisible();
});

const sizes = [
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
for (const s of sizes) {
  test(`Control tower tab row scrolls (doesn't wrap) at ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openTower(page);
    // Found live at 768px: a flex child inside overflow-x-auto shrank and wrapped its own text
    // ("Project Cash Flow" broke onto 3 lines, later tabs pushed out of view) instead of the row
    // scrolling — fixed with shrink-0/whitespace-nowrap on every trigger.
    const wrapper = page.locator("div.overflow-x-auto").first();
    const { scrollWidth, clientWidth } = await wrapper.evaluate((e) => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // A wrapped label makes the button multi-line (tall); single-line stays under one line's height.
    const tabBox = await page.getByRole("tab", { name: "Project Cash Flow" }).boundingBox();
    expect(tabBox!.height).toBeLessThan(50);
    await page.screenshot({ path: shot(`tower-interventions-${s.name}`), fullPage: true });
  });
}
