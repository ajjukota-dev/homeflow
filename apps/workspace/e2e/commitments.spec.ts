import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 13-promise-ledger.md Screens: Promise Ledger + Customer 360's Commitments section + the detail
// drawer. `assertNoHorizontalOverflow` below catches body-level overflow (e.g. a fixed-width
// element pushing the page wider than the viewport); it does NOT catch the real bug this slice's
// own live-verification found — a "New commitment" card row's flex-1 title (min-w-0 flex-1
// sharing a row with two fixed-width badges) shrinking to ~53px instead of wrapping, since
// `truncate` sets overflow:hidden and the collapse never reaches document.body.scrollWidth. That
// class of bug is regression-guarded separately, by measuring the title/badge geometry directly —
// see the mobile-width test below, which creates a real commitment (so it isn't lost on reseed)
// and asserts the badges render below the title, not squeezed onto the same line.
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

async function openPromiseLedger(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Promise Ledger|Promises/ }).first().click();
  await expect(page.getByRole("heading", { name: "Promise Ledger" })).toBeVisible();
}

for (const s of sizes) {
  test(`Promise Ledger @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openPromiseLedger(page);
    // Settle past the loading state before screenshotting/measuring.
    await expect(page.getByText(/No commitments on this project yet\.|Couldn't load commitments for this project\./).or(page.locator("table"))).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`promise-ledger-${s.name}`), fullPage: true });
  });
}

// Real commitment data only exists once this slice's own live-verification created one (Rohan
// Desai / Villa V113 — via a real CRM "New commitment" -> lifecycle-action flow). Rather than
// hardcode that and go stale on a reseed, walk the real Promise Ledger rows; if none exist yet
// (a freshly reseeded DB), assert the honest empty state instead — either way this proves the
// wiring and the layout invariant, same resilience pattern as journey.spec.ts.
test("clicking a Promise Ledger row opens the real detail drawer for that commitment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPromiseLedger(page);
  await expect(page.getByText(/No commitments on this project yet\.|Couldn't load commitments for this project\./).or(page.locator("table"))).toBeVisible();

  const codeButtons = page.locator("table tbody").getByRole("button");
  const count = await codeButtons.count();
  test.skip(count === 0, "No commitments seeded in this dev DB yet.");

  await codeButtons.first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: /^CMT-/ })).toBeVisible();
  await expect(drawer.getByText(/^Confidence \d+/)).toBeVisible();
});

// Customer 360's embedded Commitments section (CommitmentsSection.tsx) — same booking-scoped
// read this slice's Customer360.tsx wiring exercises live.
test("Customer 360's Commitments section renders for a real customer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /CRM \/ RM|^CRM$/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();

  const activeCustomers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Active customers" }) });
  await expect(activeCustomers.getByRole("button").first().or(activeCustomers.getByText("No customers yet"))).toBeVisible();
  const customerButtons = activeCustomers.getByRole("button");
  test.skip((await customerButtons.count()) === 0, "No customers seeded in this dev DB.");

  await customerButtons.first().click();
  await expect(page.getByRole("heading", { name: "Commitments" })).toBeVisible();
  // Settle past the loading skeleton — either the honest empty state, an error, or at least one
  // real commitment row (a Card button rendered by CommitmentsSection.tsx).
  // .first(): a booking can carry more than one commitment (this spec file's own later test
  // creates several against the shared dev DB) — .or() still throws strict-mode with >1 match.
  await expect(
    page
      .getByText("No commitments recorded on this booking yet.")
      .or(page.getByText("Couldn't load commitments for this booking."))
      .or(page.getByRole("button", { name: /CMT-/ }).first())
  ).toBeVisible();
});

// Regression guard for the real bug this slice's live-verification found (see header comment):
// creates a real commitment through the actual "New commitment" flow — rather than a fixture, so
// this survives a reseed and exercises the create path too — then measures, at the exact mobile
// width the bug appeared at, that the title and badges are genuinely stacked (flex-col) rather
// than squeezed onto one line (the collapsed-to-~53px failure mode `truncate`'s overflow:hidden
// hides from a body-scrollWidth check). Also drives the commitment to AT_RISK to check the
// drawer's 3-button actions row (Fulfil / Record recovery plan / Waive-cancel) at 375px — that
// row was previously only ever seen at 1440, the same button-group-overflow class of bug
// PageHeader's own earlier slice found.
test("a long commitment title wraps below its badges, not into them, at mobile width — and the AT_RISK actions row doesn't overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /CRM \/ RM|^CRM$/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();

  const activeCustomers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Active customers" }) });
  await expect(activeCustomers.getByRole("button").first().or(activeCustomers.getByText("No customers yet"))).toBeVisible();
  const customerButtons = activeCustomers.getByRole("button");
  test.skip((await customerButtons.count()) === 0, "No customers seeded in this dev DB.");
  await customerButtons.first().click();
  await expect(page.getByRole("heading", { name: "Commitments" })).toBeVisible();

  const newButton = page.getByRole("button", { name: "New commitment" });
  test.skip(!(await newButton.isVisible().catch(() => false)), "Logged-in role has no write access to commitments.");

  const description = "Complimentary annual AMC visit, twice yearly, for the first three years after handover";
  await newButton.click();
  await page.getByLabel(/Description/).fill(description);
  await page.getByLabel("Owner (user id)").fill("user_crm");
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Due date").fill(dueDate);
  await page.getByRole("button", { name: "Create commitment" }).click();

  // .first(): commitmentsForBooking orders by committed_at DESC, so a repeated local run against
  // a non-reset dev DB (creating another row with the same description) always puts the one this
  // run just made at the top.
  const row = page.getByRole("button", { name: new RegExp(description.slice(0, 30)) }).first();
  await expect(row).toBeVisible();

  const geometry = await row.evaluate((el, desc) => {
    const title = Array.from(el.querySelectorAll<HTMLElement>("div")).find((d) => d.textContent === desc);
    const badgeRow = title?.parentElement?.nextElementSibling as HTMLElement | null;
    if (!title || !badgeRow) return null;
    const t = title.getBoundingClientRect();
    const b = badgeRow.getBoundingClientRect();
    return { titleWidth: t.width, titleBottom: t.bottom, badgeTop: b.top };
  }, description);
  expect(geometry).not.toBeNull();
  // The bug's exact failure mode: a `min-w-0 flex-1` title sharing a line with fixed-width badges
  // shrinks to ~53px instead of wrapping to a new line.
  expect(geometry!.titleWidth).toBeGreaterThan(150);
  expect(geometry!.badgeTop).toBeGreaterThanOrEqual(geometry!.titleBottom - 2);

  await row.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "Activate" })).toBeVisible();
  await drawer.getByRole("button", { name: "Activate" }).click();
  await expect(drawer.getByRole("button", { name: "Flag at risk" })).toBeVisible();
  await drawer.getByRole("button", { name: "Flag at risk" }).click();
  await drawer.getByRole("button", { name: "Confirm flag at risk" }).click();

  await expect(drawer.getByRole("button", { name: "Fulfil" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Record recovery plan" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Waive / cancel" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: shot("commitment-drawer-at-risk-mobile"), fullPage: true });
});

// 13-promise-ledger.md Acceptance: "seeded booking with one ACTIVE commitment → gate `commitments`
// open with blocker text naming the commitment; fulfil → gate passes (replaces PR #7's 'Not
// verified')." Drives this end to end against the real API + real QaHandover UI, on a real QA
// handover villa (not a fixture) — this is the actual regression guard for QaHandover.tsx's fix
// (removing the hardcoded "Not verified" chip), since a chip-count assertion alone can't tell a
// working gate from one hardcoded to either state. Reads the gate JSON directly (not the rendered
// blocker list) because QaHandover.tsx only ever shows the first 3 of a booking's hard blockers —
// a villa with other open hard gates would truncate the commitment's own blocker text out of the
// DOM even with a fully working gate.
test("handover gate integration: an open commitment blocks the commitments gate; fulfilling it passes the gate", async ({ page }) => {
  const before = await (await page.request.get("/api/projects/p_eastcrest/handover")).json();
  const handovers: { booking_id: string; customer_name: string; unit_number: string; gates: { type: string; state: string; blockers: string[] }[] }[] = before.data;
  test.skip(handovers.length === 0, "No handover-eligible bookings seeded in this dev DB.");
  const target = handovers[0];

  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const createResp = await page.request.post("/api/commitments", {
    data: {
      booking_id: target.booking_id,
      category: "OTHER",
      description: "e2e acceptance test commitment",
      source: "CRM",
      beneficiary: "INTERNAL",
      customer_facing: false,
      owner_user_id: "user_crm",
      due_date: dueDate,
      approval_required: false, // auto-APPROVED, which rule 8's open set already includes
    },
  });
  expect(createResp.ok(), `create failed: ${await createResp.text()}`).toBe(true);
  const created = await createResp.json();
  const commitmentId: string = created.data.id;
  const code: string = created.data.code;

  const afterOpen = await (await page.request.get("/api/projects/p_eastcrest/handover")).json();
  const rowOpen = (afterOpen.data as typeof handovers).find((h) => h.booking_id === target.booking_id)!;
  const gateOpen = rowOpen.gates.find((g) => g.type === "commitments")!;
  expect(gateOpen.state).toBe("open");
  expect(gateOpen.blockers.some((b) => b.startsWith(code))).toBe(true);

  // UI-level check: the same villa's chip reads "Open" after a reload — confirms QaHandover.tsx
  // is rendering the real per-gate state, not a hardcoded placeholder.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();
  await expect(page.getByRole("heading", { name: "QA & handover" })).toBeVisible();
  // Scoped to the "Handover gates" section specifically — the "Unit readiness" section above it
  // renders an identically-worded "<name> · Villa <unit>" card headline for the same booking, so
  // an unscoped match resolves to two elements.
  const handoverGatesSection = page.locator("h2", { hasText: "Handover gates" }).locator("xpath=following-sibling::div[1]");
  const villaHeading = handoverGatesSection.getByText(`${target.customer_name} · Villa ${target.unit_number}`, { exact: true });
  await expect(villaHeading).toBeVisible();
  // Card.tsx's root div carries "rounded-card" — the stable class to anchor on (not a class from
  // this page's own layout, which can shift independently of which card wraps which content).
  const villaCard = villaHeading.locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
  await expect(villaCard.getByText("Commitments · Open")).toBeVisible();

  // fulfil requires ACTIVE/AT_RISK, not APPROVED — rule 8's open set is wider than fulfilCommitment's
  // own precondition, so activation is a real intermediate step even though the gate was already
  // open at APPROVED.
  const activateResp = await page.request.post(`/api/commitments/${commitmentId}/activate`);
  expect(activateResp.ok(), `activate failed: ${await activateResp.text()}`).toBe(true);

  const fulfilResp = await page.request.post(`/api/commitments/${commitmentId}/fulfil`, { data: { evidence_file_ids: ["e2e test evidence"] } });
  expect(fulfilResp.ok(), `fulfil failed: ${await fulfilResp.text()}`).toBe(true);

  const afterFulfil = await (await page.request.get("/api/projects/p_eastcrest/handover")).json();
  const rowPassed = (afterFulfil.data as typeof handovers).find((h) => h.booking_id === target.booking_id)!;
  const gatePassed = rowPassed.gates.find((g) => g.type === "commitments")!;
  expect(gatePassed.state).toBe("passed");
  expect(gatePassed.blockers).toHaveLength(0);
});
