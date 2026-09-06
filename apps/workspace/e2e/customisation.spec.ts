import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 18-change-requests.md Screens: Customisation desk (kanban by status) + CR detail drawer +
// Studio tabs (Variation approval matrix / Customisation policy). Every test scopes getByRole
// to page.locator("main") and/or uses exact:true for short/common labels — the established
// fix for getByRole's substring matching against this app's own nav button labels (the H11
// class of bug this session has hit before).
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function openDesk(page: Page) {
  await page.goto("/");
  // Mobile's nav chip row renders only nav.ts's `short` label ("Custom.") — desktop/tablet render
  // the full label + role description as one accessible name.
  await page.getByRole("button", { name: /Customisation Desk|^Custom\.$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Customisation desk", exact: true })).toBeVisible();
}

for (const s of sizes) {
  test(`Customisation desk renders @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openDesk(page);
    await expect(
      page.locator("main").getByText("No change requests yet for this project.").or(page.locator("main").getByText(/^CR-\d{6}$/).first())
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`customisation-desk-${s.name}`), fullPage: true });
  });
}

// Creates its own fixture — a fresh CR raised through the real "+ Raise request" dialog against a
// real booking (not a hardcoded fixture id, so this survives a reseed) — and drives it through
// capture -> feasibility -> costing (item + impact) -> submit -> quotation -> payment waiver ->
// APPROVED, exercising the real rule 1 gate-exception grant+link flow when this unit's own
// progress-derived gate state calls for it. This is the actual regression guard for withLabels()
// (unit/booking never shown raw) and for the "write with no matching read" GET routes this
// slice added (items/quotation/approvals/execution-actions).
test("raising a change request routes it through capture, feasibility, costing and approval to APPROVED", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDesk(page);

  const main = page.locator("main");
  await main.getByRole("button", { name: "+ Raise request" }).click();
  const dialog = page.getByRole("dialog", { name: "Raise a change request" });
  await dialog.getByRole("combobox", { name: "Booking" }).click();
  const bookingOption = page.getByRole("option", { name: /Villa V111/ });
  test.skip(!(await bookingOption.isVisible().catch(() => false)), "Villa V111's booking not seeded in this dev DB.");
  await bookingOption.click();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Electrical" }).click();
  const title = `e2e electrical rewiring ${Date.now()}`;
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  await dialog.getByRole("textbox", { name: "Summary" }).fill("Add three additional power points in the study.");
  await dialog.getByRole("button", { name: "Raise request" }).click();

  const card = main.getByRole("button", { name: new RegExp(title) });
  await expect(card).toBeVisible();
  // Regression guard: never a raw unit_id/booking_id, always the friendly "Villa <no> · <code>" label.
  await expect(card).toContainText(/Villa V111 · BK-V111/);

  await card.click();
  const drawer = page.getByRole("dialog", { name: new RegExp(`^CR-\\d{6} · ${title}$`) });
  // exact: true — "Feasibility review" (the status badge) vs the impact panel's own heading
  // "Feasibility review (rule 2)" would otherwise strict-mode-collide.
  await expect(drawer.getByText("Feasibility review", { exact: true })).toBeVisible();
  await expect(drawer.getByText("V111", { exact: true })).toBeVisible();

  await drawer.getByRole("combobox", { name: "Result" }).click();
  await page.getByRole("option", { name: "Feasible", exact: true }).click();
  await drawer.getByRole("textbox", { name: "Technical notes" }).fill("No structural conflicts found in the study wall.");
  await drawer.getByRole("button", { name: "Record feasibility" }).click();

  await expect(drawer.getByText("Costing")).toBeVisible();
  await drawer.getByRole("textbox", { name: "Description" }).fill("Three additional power points, study room");
  await drawer.getByRole("spinbutton", { name: "Unit price (₹)" }).fill("18000");
  await drawer.getByRole("spinbutton", { name: "Vendor cost (₹)" }).fill("11000");
  await drawer.getByRole("button", { name: "Save items" }).click();
  await expect(drawer.getByRole("term", { name: "Contribution" }).or(drawer.getByText("Contribution"))).toBeVisible();

  await drawer.getByRole("spinbutton", { name: "Cost (₹)", exact: true }).fill("18000");
  await drawer.getByRole("spinbutton", { name: "Schedule impact (days)" }).fill("3");
  await drawer.getByRole("textbox", { name: "Notes" }).fill("No handover delay.");
  await drawer.getByRole("button", { name: "Save impact" }).click();

  const bookings = await (await page.request.get("/api/bookings?status=active")).json();
  const bookingId = bookings.data.find((b: { booking_number: string }) => b.booking_number === "BK-V111").id;
  const listed = await (await page.request.get(`/api/change-requests?booking_id=${bookingId}`)).json();
  const cr = listed.data.find((c: { title: string }) => c.title === title);

  // V111's electrical gate is EXCEPTION_ONLY only in some seed states (gate state is derived from
  // this unit's own progress, which varies) — exercise the real exception-grant + link + block
  // path when it applies, and fall through to a plain submit otherwise. Either way is a legitimate
  // rule-1 outcome for this unit's actual state, not a fixture assumption.
  const needsException = await drawer.getByText(/EXCEPTION_ONLY — grant a unit_gate_exception/).isVisible().catch(() => false);
  if (needsException) {
    await drawer.getByRole("button", { name: "Submit for approval" }).click();
    await expect(drawer.getByRole("alert")).toContainText(/EXCEPTION_ONLY/);

    const grant = await page.request.post(`/api/units/${cr.unit_id}/gate-exceptions`, {
      data: { category_code: "electrical", reason: "e2e test exception grant", evidence_file_keys: ["e2e-exception.pdf"], valid_until: "2027-01-01" },
    });
    expect(grant.ok(), `grant failed: ${await grant.text()}`).toBe(true);
    const exception = (await grant.json()).data;

    await drawer.getByRole("textbox", { name: "Exception id" }).fill(exception.id);
    await drawer.getByRole("button", { name: "Link exception" }).click();
  }
  await drawer.getByRole("button", { name: "Submit for approval" }).click();

  // Either AWAITING_APPROVAL (a rule-4 threshold matched) or straight to AWAITING_CUSTOMER —
  // both are legitimate per rule 4; assert whichever the real approval-matrix rules produced.
  await expect(drawer.getByText(/Awaiting approval|Awaiting customer/)).toBeVisible();
  if (await drawer.getByText("Awaiting approval").isVisible().catch(() => false)) {
    // Approve every pending line so the CR can still reach quotation in this same test run.
    const approvals = await (await page.request.get(`/api/change-requests/${cr.id}/approvals`)).json();
    for (const a of approvals.data) {
      if (a.decision === "PENDING") {
        const decideResp = await page.request.post(`/api/change-request-approvals/${a.action_id}/decide`, { data: { decision: "APPROVE", note: "e2e auto-approve" } });
        expect(decideResp.ok(), `decide failed: ${await decideResp.text()}`).toBe(true);
      }
    }
    await page.reload();
    await card.click();
  }
  await expect(drawer.getByText("Awaiting customer")).toBeVisible();

  await drawer.getByRole("button", { name: "Issue quotation" }).click();
  await expect(drawer.getByText("ISSUED")).toBeVisible();
  await drawer.getByRole("button", { name: "Record signed-copy acceptance" }).click();
  await expect(drawer.getByText("Awaiting payment")).toBeVisible();

  await drawer.getByRole("textbox", { name: "Waiver reason" }).fill("e2e test waiver — no receipt-posting UI wired to this gate yet.");
  await drawer.getByRole("button", { name: "Waive payment" }).click();
  await expect(drawer.getByText("Approved", { exact: true })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

// 18-change-requests.md Studio tabs. cr_approval_rule/customisation_policy were already
// built:true on the backend (services/api/src/studio/registry.ts) before this slice — the
// regression this guards is Shell.tsx's BESPOKE_TABS wiring, not the underlying routes.
test("Policy Studio: Variation approval matrix and Customisation policy tabs render real seeded data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /Policy Studio/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Policy Studio" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Policy Studio tabs" });
  await nav.getByRole("button", { name: "Variation approval matrix" }).click();
  const content = page.locator("main");
  await expect(content.getByRole("heading", { name: "Variation approval matrix" })).toBeVisible();
  await expect(content.getByRole("button", { name: "Save matrix" })).toBeVisible();
  // Not empty and not a raw-id table — real rule rows with named approver roles.
  await expect(content.getByRole("textbox", { name: "Approver role" }).first()).not.toHaveValue("");

  await nav.getByRole("button", { name: "Customisation policy" }).click();
  await expect(content.getByRole("heading", { name: "Customisation policy" })).toBeVisible();
  const validity = content.getByRole("spinbutton", { name: "Quotation validity (days)" });
  await expect(validity).toBeVisible();
  const before = await validity.inputValue();
  await validity.fill("30");
  await content.getByRole("button", { name: "Save policy" }).click();
  await expect(validity).toHaveValue("30");
  // Restore, so a repeated local run against a non-reset dev DB doesn't drift the seeded default.
  await validity.fill(before);
  await content.getByRole("button", { name: "Save policy" }).click();
});
