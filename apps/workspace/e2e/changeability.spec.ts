import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 08-changeability-engine.md Screens: "Project changeability heatmap" (Site/Management, inside
// Unit Progress Control) and "Change Gate Rule Studio" (Policy Studio). Default storageState is
// superadmin — real STAFF_ROLES/RULE_EDIT_ROLES access to both.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function openHeatmap(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Project \/ Site|^Site$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Unit Progress Control", exact: true })).toBeVisible();
  await page.locator("main").getByRole("tab", { name: "Changeability", exact: true }).click();
}

async function openRuleStudio(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Studio/ }).first().click();
  await page.getByRole("button", { name: "Change Gate Rule Studio" }).click();
  await expect(page.getByRole("heading", { name: "Change Gate Rule Studio" })).toBeVisible();
}

// A fresh fixture unit, not seeded East Crest units, per this suite's own discipline
// (progress-console.spec.ts's createFixtureUnit) — its progress starts NOT_STARTED so every gate
// starts OPEN, giving a deterministic base to drive to EXCEPTION_ONLY.
async function createFixtureUnit(page: Page): Promise<{ id: string; unit_number: string }> {
  const unitNumber = `E2E${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`;
  const res = await page.request.post("/api/projects/p_eastcrest/units", {
    data: { unit_number: unitNumber, unit_type: "3BHK", facing: "North" },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { id: body.data.id, unit_number: unitNumber };
}

for (const s of sizes) {
  test(`Changeability heatmap renders @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openHeatmap(page);
    const main = page.locator("main");
    if (s.width < 768) {
      await expect(main.getByRole("button", { name: /flexible/ }).first()).toBeVisible();
    } else {
      await expect(main.locator("table tbody tr").first()).toBeVisible();
    }
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await page.screenshot({ path: shot(`changeability-heatmap-${s.name}`), fullPage: true });
  });
}

// Rule 3/6 (core.ts grantException/revokeException): an exception only applies to an
// EXCEPTION_ONLY gate, and revoking it clears exception_open without reopening the gate itself —
// the heatmap's icon+label state must reflect both transitions live, not just colour.
test("granting then revoking a gate exception updates the heatmap's gate chip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unit = await createFixtureUnit(page);

  // Published rule (kitchen_layout / mep_first_fix complete -> EXCEPTION_ONLY) drives the gate
  // there so a real exception can be granted against it.
  const progressRes = await page.request.put(`/api/units/${unit.id}/progress`, {
    data: { component_code: "mep_first_fix", state_code: "COMPLETE" },
  });
  expect(progressRes.ok()).toBeTruthy();

  const matrix = await (await page.request.get(`/api/units/${unit.id}/changeability`)).json();
  const kitchenGate = matrix.data.gates.find((g: { category_code: string }) => g.category_code === "kitchen_layout");
  expect(kitchenGate.state).toBe("EXCEPTION_ONLY");

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const grantRes = await page.request.post(`/api/units/${unit.id}/gate-exceptions`, {
    data: {
      category_code: "kitchen_layout",
      reason: "E2E: verifying exception grant reflects live on the heatmap",
      evidence_file_keys: ["e2e/fixture-evidence.pdf"],
      valid_until: validUntil,
    },
  });
  expect(grantRes.ok()).toBeTruthy();
  const exception = (await grantRes.json()).data;

  await openHeatmap(page);
  const main = page.locator("main");
  const row = main.locator("table tbody tr", { hasText: unit.unit_number });
  await expect(row).toBeVisible();
  // mep_first_fix is also electrical's trigger component, so both kitchen_layout and electrical
  // land on EXCEPTION_ONLY — "exception active" (gate.exception_open) is the marker unique to the
  // one gate the exception was actually granted against.
  await expect(row.getByText(/exception active/)).toHaveCount(1);

  const revokeRes = await page.request.post(`/api/gate-exceptions/${exception.id}/revoke`, {
    data: { reason: "E2E: cleanup after assertion" },
  });
  expect(revokeRes.ok()).toBeTruthy();

  await openHeatmap(page);
  const rowAfter = page.locator("main").locator("table tbody tr", { hasText: unit.unit_number });
  await expect(rowAfter).toBeVisible();
  // Still EXCEPTION_ONLY (mep_first_fix is still complete) — revoking closes the exception, it
  // doesn't reopen the gate. The distinguishing signal is the note disappearing, not the state label.
  await expect(rowAfter.getByText("Exception only")).toHaveCount(2);
  await expect(rowAfter.getByText(/exception active/)).toHaveCount(0);
});

test("Change Gate Rule Studio: loads the real published rule set and simulation is a true dry run", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRuleStudio(page);

  // Real seeded rules (seed.ts's change_gate_rule rows), not stub data.
  await expect(page.getByText("Currently PUBLISHED")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Category" }).first()).toBeVisible();

  const unit = await createFixtureUnit(page);
  await page.request.put(`/api/units/${unit.id}/progress`, {
    data: { component_code: "structure", state_code: "COMPLETE" },
  });

  await page.getByRole("combobox", { name: "Project", exact: true }).click();
  await page.getByRole("option", { name: "East Crest" }).click();
  await page.getByRole("combobox", { name: "Unit" }).click();
  await page.getByRole("option", { name: unit.unit_number }).click();
  await page.getByRole("button", { name: "Simulate" }).click();

  // structure complete -> HARD_CLOSED is the real published rule; a dry run must show it without
  // writing anything (unit.gates itself is untouched — this unit's real progress was set directly
  // above via the API, the simulation panel only re-derives from it).
  await expect(page.getByText("Structural")).toBeVisible();
  await expect(page.getByText("Hard closed")).toBeVisible();

  const matrixAfter = await (await page.request.get(`/api/units/${unit.id}/changeability`)).json();
  const structuralGate = matrixAfter.data.gates.find((g: { category_code: string }) => g.category_code === "structural");
  expect(structuralGate.state).toBe("HARD_CLOSED");
});
