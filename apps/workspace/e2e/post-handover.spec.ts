import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 30-post-handover.md Screens: the FM/CRM Post-handover module (cases list + case view: move-in
// checklist, DLP windows, warranty case lifecycle, passport, service history, advocacy) that
// replaced the legacy warranty.ts-backed PostHandover.tsx. Drives the seeded, already-handed-over
// customer Rohan Desai / Villa V113 (b_v113/u_v113) — the only seeded post_handover_case in the
// whole demo dataset (seed-lifecycle.ts's own seedHandedOverVilla now calls the real
// openPostHandoverCase after its handover_record insert, same "seed bypassed the event" fix class
// as spec 09's unit_specification gap). Default page fixture is SUPER_ADMIN (e2e/.auth/
// superadmin.json), which has WRITE on "handovers" and is in CRM_UPDATE_ROLES for advocacy, so the
// whole flow runs against one page — no second-context login needed, unlike communications.spec.ts's
// guardrail test. This file sorts after commitments/communications/customer-updates/customisation
// (none of which touch post_handover_case/warranty_case/home_passport_item/service_history/
// advocacy for V113) and before registration/sales-desk/sales-handover/sla-policies/
// specification-studio/visual — visual.spec.ts's own "After keys" smoke test and journeys/
// sale-to-handover.spec.ts's read-only walk were both updated to match this screen's real content
// rather than the legacy screen's "month cover" copy this replaced.
test("cases list, move-in checklist, full warranty lifecycle, passport, service history, advocacy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^After/ }).first().click();
  await expect(page.getByRole("heading", { name: "After keys" })).toBeVisible();

  const row = page.getByRole("row", { name: /V113/ });
  await expect(row).toContainText("0/7 done");
  await expect(row).toContainText("1 open");
  await row.click();

  // Move-in checklist: tick one task. The background list row is behind Radix Dialog's own
  // aria-hidden on the rest of the page while the drawer is open, so its updated count can only be
  // asserted after closing — checked further down, alongside the warranty-close count.
  await page.getByRole("checkbox", { name: "Facility introduction walkthrough" }).click();
  await expect(page.getByRole("checkbox", { name: "Facility introduction walkthrough" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Facility introduction walkthrough" })).toBeDisabled();

  await expect(page.getByRole("heading", { name: "Defect-liability windows" })).toBeVisible();
  await expect(page.getByText(/STRUCTURAL · \d+ mo/)).toBeVisible();
  await expect(page.getByText("Day 7")).toBeVisible();

  // Full warranty case lifecycle against the seeded case (open -> triaged -> assigned ->
  // in_progress -> resolved -> closed), driven by the real state machine — every button here maps
  // 1:1 to a server-side assertFrom guard.
  await page.getByRole("tab", { name: "Warranty" }).click();
  const caseRow = page.getByRole("button", { name: /Guest-bath mixer drips overnight/ });
  await expect(caseRow).toContainText("Open");
  await caseRow.click();
  await page.getByRole("button", { name: "Triage" }).click();
  await expect(caseRow).toContainText("Triaged");
  await expect(page.getByText("In coverage")).toBeVisible();

  await page.getByRole("combobox", { name: "Contractor" }).click();
  await page.getByRole("option", { name: "Sunrise Plumbing & Waterproofing" }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(caseRow).toContainText("Assigned");

  await page.getByRole("button", { name: "Start work" }).click();
  await expect(caseRow).toContainText("In progress");

  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(caseRow).toContainText("Resolved");

  await page.getByRole("button", { name: "Close case" }).click();
  await expect(caseRow).toContainText("Closed");

  // Close the drawer: the outer list's move-in and "open warranty cases" counts are separate
  // fetches from the panels' own — regression guard for a real staleness bug found live while
  // building this (WarrantyPanel wasn't notifying the parent list on a status change). Radix
  // Dialog's aria-hidden on the rest of the page means these can only be asserted with the drawer
  // closed, not while it's open.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(row).toContainText("1/7 done");
  await expect(row).toContainText("None");
  await page.screenshot({ path: shot("post-handover-warranty-closed"), fullPage: true });
  await row.click();

  // Service history: both vocabularies show honestly — the seed's legacy dotted event_type
  // alongside the WARRANTY_FIX record resolveWarrantyCase's own auto-insert just created, with a
  // real actor name, not a raw user_id (the raw-id-leak fix caught live while building this).
  await page.getByRole("tab", { name: "Service history" }).click();
  await expect(page.getByText("handover.completed")).toBeVisible();
  await expect(page.getByText("WARRANTY_FIX")).toBeVisible();
  await expect(page.getByText(/^user_/)).not.toBeVisible();

  // Passport: add a real item, see it in the list.
  await page.getByRole("tab", { name: "Passport" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByPlaceholder("Category (e.g. AC, Water heater)").fill("Dishwasher");
  await page.getByPlaceholder("Name").fill("Kitchen dishwasher");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Kitchen dishwasher")).toBeVisible();

  // Advocacy: SUPER_ADMIN is in CRM_UPDATE_ROLES, so this runs on the same page/context —
  // invite -> received -> published.
  await page.getByRole("tab", { name: "Advocacy" }).click();
  await page.getByRole("button", { name: "Invite: referral" }).click();
  await expect(page.getByText("INVITED")).toBeVisible();
  await page.getByRole("button", { name: "Mark received" }).click();
  await expect(page.getByText("RECEIVED")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("PUBLISHED")).toBeVisible();
});

// FM lacks CRM_UPDATE_ROLES — listAdvocacy 403s server-side, and the panel must show a plain
// "not for your role" message instead of misreporting the 403 as "Couldn't reach the API" (the
// exact bug found live while building this).
test("FM sees the Advocacy tab as role-limited, not a fake API error", async ({ browser }) => {
  // Default `page` is pre-authenticated (e2e/.auth/superadmin.json) — a fresh, unauthenticated
  // context is needed to sign in as a different role, same pattern as communications.spec.ts's
  // guardrail test.
  const fmCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const fm = await fmCtx.newPage();
  await fm.goto("/");
  await fm.getByLabel("Email").fill("fm@demo.pranava");
  await fm.getByLabel("Password").fill("Demo@2026");
  await fm.getByRole("button", { name: "Sign in" }).click();
  await expect(fm.getByRole("heading", { name: "After keys" })).toBeVisible();
  await fm.getByRole("row", { name: /V113/ }).click();
  await fm.getByRole("tab", { name: "Advocacy" }).click();
  await expect(fm.getByText("managed by CRM")).toBeVisible();
  await expect(fm.getByText("Couldn't reach the API")).not.toBeVisible();
  await fmCtx.close();
});

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
for (const s of sizes) {
  test(`After keys case view renders at @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^After/ }).first().click();
    await expect(page.getByRole("heading", { name: "After keys" })).toBeVisible();
    await page.getByRole("row", { name: /V113/ }).click();
    await expect(page.getByRole("heading", { name: "Move-in checklist" })).toBeVisible();
    await page.screenshot({ path: shot(`post-handover-${s.name}`), fullPage: true });
  });
}
