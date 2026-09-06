import { test, expect, request, type Page, type Browser } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 17-sales-crm-handover.md Acceptance line: "submit blocked with missing list → complete → submit
// → CRM return → resubmit → accept". Default storageState is SUPER_ADMIN (playwright.config.ts).
// core.ts's acceptHandover/returnHandover both refuse `ctx.actor.user_id === h.submitted_by`
// ("the submitter cannot accept/return their own handover") — a real separation-of-duties rule
// (rules 5/6), unlike the pre-existing bookings-crm.ts accept/return which has no such check. So
// the CRM-side actions here run under a second, real CRM actor (crm@demo.pranava), not the same
// SUPER_ADMIN session that booked and submitted — found live 2026-09-07 when a single-session
// version of this test hit that guard.
async function crmSession(browser: Browser): Promise<Page> {
  const ctx = await request.newContext({ baseURL: "http://localhost:5173" });
  const res = await ctx.post("/api/auth/login", { data: { email: "crm@demo.pranava", password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`crm login failed: ${res.status()} ${await res.text()}`);
  const storageState = await ctx.storageState();
  await ctx.dispose();
  const browserCtx = await browser.newContext({ storageState });
  const p = await browserCtx.newPage();
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto("/");
  return p;
}

async function bookVilla(page: Page, applicant: string, phone: string, pan: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Sales/ }).first().click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await page.getByRole("button", { name: "Book this villa" }).first().click();
  await expect(page.getByRole("heading", { name: /Book Villa/ })).toBeVisible();
  await page.getByPlaceholder("e.g. Anita Sharma").fill(applicant);
  await page.getByPlaceholder("10-digit mobile").fill(phone);
  await page.getByPlaceholder("ABCDE1234F").fill(pan);
  await page.getByPlaceholder(/00,000/).fill("8200000");
  // docs starts as [] and only populates once api.bookingConfig() resolves (BookingWizard.tsx) —
  // wait for the first checkbox to actually render before iterating, or this loop silently clicks
  // nothing and the Submit button never enables (60c8b3d, found live 2026-09-07).
  await page.getByRole("checkbox").first().waitFor();
  for (const doc of await page.getByRole("checkbox").all()) await doc.click();
  await page.getByRole("button", { name: "Submit to CRM" }).click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
}

async function openPacket(page: Page, applicant: string) {
  // Mobile header renders nav.ts's `short` label ("Handover"), not the full `label`
  // ("Handover Packets") the desktop sidebar uses (Workspace.tsx) — match both, but anchored:
  // an unanchored /Handover/ also matches the pre-existing "QA / Handover" nav entry's
  // accessible name ("QA / Handover Evidence, then keys"), which sorts earlier in NAV and wins
  // `.first()` at desktop width.
  await page.getByRole("button", { name: /^Handover/ }).first().click();
  await expect(page.getByRole("heading", { name: "Handover Packets" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(applicant) }).first().click();
  const drawer = page.getByRole("dialog", { name: applicant });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function fillConfirmations(drawer: ReturnType<Page["getByRole"]>) {
  for (const label of [
    "Applicant details confirmed",
    "Contact details verified",
    "Residency status confirmed",
    "Communication preference confirmed",
    "Unit confirmed",
    "Facing confirmed",
    "Parking confirmed",
  ]) {
    await drawer.getByRole("checkbox", { name: label }).check();
  }
  await drawer.getByLabel("Payment plan reference").fill("PP-STD-24M");
}

test("submit blocked with missing list → complete → submit → CRM return → resubmit → accept", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const applicant = "Deepa Krishnan";
  await bookVilla(page, applicant, "9845011223", "DEEPK1234N");

  let drawer = await openPacket(page, applicant);

  // Real MANDATORY_DOCS matching (bookings.ts) — this booking's docs were all ticked in the
  // wizard, so the checklist should already show them satisfied, and never show the old
  // fictional item names ("Booking Form"/"Cost Sheet"/"Identity Proof") that no real booking can
  // ever produce (2026-09-07 bug, sales-handover/core.ts + seed/handover-checklist.ts).
  // Scoped to the Documents badge (a <span>, unlike the checklist/blockers <li> items) so this
  // stays unambiguous even if "PAN card" also becomes an unsatisfied checklist item — a real
  // mutation-test failure mode found live 2026-09-07 (strict-mode collision masked the intended
  // 100% regression-guard assertion below from ever running).
  await expect(drawer.locator("span", { hasText: "PAN card" })).toBeVisible();
  await expect(drawer.getByText("Booking Form")).toHaveCount(0);
  await expect(drawer.getByText("Cost Sheet")).toHaveCount(0);
  await expect(drawer.getByText("Identity Proof")).toHaveCount(0);

  // Blocked: submit with nothing else filled in yet.
  await drawer.getByRole("button", { name: "Submit for CRM review" }).click();
  const blockedNotice = drawer.getByRole("alert").filter({ hasText: "Saved, but not submitted" });
  await expect(blockedNotice).toBeVisible();
  // "Payment Plan Ref" also appears as the field's own label ("Payment plan reference") elsewhere
  // in the form and (after this) in the returned-packet notice — scope to this specific alert.
  await expect(blockedNotice.getByText("Payment Plan Ref")).toBeVisible();

  // Complete + submit (Sales actor).
  await fillConfirmations(drawer);
  await drawer.getByRole("button", { name: "Submit for CRM review" }).click();
  await expect(drawer.getByText("Submitted")).toBeVisible();
  await expect(drawer.getByText("100%")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Accept" })).toBeVisible();
  await page.screenshot({ path: shot("handover-submitted-desktop"), fullPage: true });

  // CRM (a different real actor — see crmSession's comment) returns it.
  const crmPage = await crmSession(browser);
  let crmDrawer = await openPacket(crmPage, applicant);
  await crmDrawer.getByRole("button", { name: "Return to Sales" }).click();
  await crmDrawer.getByRole("combobox", { name: "Reason" }).click();
  await crmPage.getByRole("option", { name: "Customer details incomplete or unverified" }).click();
  await crmDrawer.getByLabel("Note").fill("Please re-check the PAN before resubmitting.");
  await crmDrawer.getByRole("button", { name: "Confirm return" }).click();
  // "Returned" also substring-matches the return-reason alert text below the status chip — match
  // the chip exactly.
  await expect(crmDrawer.getByText("Returned", { exact: true })).toBeVisible();
  await expect(crmDrawer.getByText(/Returned by CRM: Please re-check the PAN/)).toBeVisible();
  await crmDrawer.getByRole("button", { name: "Close" }).click();

  // Back to Sales: reload to see the RETURNED status written by the other session, then resubmit.
  await page.reload();
  drawer = await openPacket(page, applicant);
  await expect(drawer.getByText(/Returned by CRM: Please re-check the PAN/)).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Resubmit for CRM review" })).toBeVisible();
  await drawer.getByRole("button", { name: "Resubmit for CRM review" }).click();
  await expect(drawer.getByText("Submitted")).toBeVisible();

  // Back to CRM: reload to see the resubmit, then accept.
  await crmPage.reload();
  crmDrawer = await openPacket(crmPage, applicant);
  await crmDrawer.getByRole("button", { name: "Accept" }).click();
  // Same chip-vs-alert-text collision as "Returned" above — the terminal alert also starts with
  // "Accepted", so match the chip exactly.
  await expect(crmDrawer.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(crmDrawer.getByText(/Accepted — /)).toBeVisible();
  await crmPage.screenshot({ path: shot("handover-accepted-desktop"), fullPage: true });

  // Journey exists (rule 5's real acceptHandover side effect, same event bookings-crm.ts's own
  // accept already fires on) — visible via the booking's now-real customer record.
  await crmDrawer.getByRole("button", { name: "Close" }).click();
  await crmPage.getByRole("button", { name: /^CRM/ }).first().click();
  await expect(crmPage.getByRole("button", { name: new RegExp(applicant) }).first()).toBeVisible();
});

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
for (const s of sizes) {
  test(`Handover Packets list @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    // Mobile header renders nav.ts's `short` label ("Handover"), not the full `label`
  // ("Handover Packets") the desktop sidebar uses (Workspace.tsx) — match both, but anchored:
  // an unanchored /Handover/ also matches the pre-existing "QA / Handover" nav entry's
  // accessible name ("QA / Handover Evidence, then keys"), which sorts earlier in NAV and wins
  // `.first()` at desktop width.
  await page.getByRole("button", { name: /^Handover/ }).first().click();
    await expect(page.getByRole("heading", { name: "Handover Packets" })).toBeVisible();
    // The list itself renders after an async api.listBookings() fetch (HandoverPackets.tsx) — the
    // heading is static and visible immediately, so without this the overflow check and screenshot
    // below can race ahead of the fetch and capture the page before any card has rendered (found
    // live 2026-09-07: verified the real page renders correctly and instantly via manual check —
    // this was a test-only timing gap, not a product bug). Wait for an actual card, not just
    // network-idle — an idle wait passes just as well on a blank page and would let these three
    // tests assert nothing.
    await page.getByRole("button", { name: /Villa/ }).first().waitFor();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await page.screenshot({ path: shot(`handover-packets-${s.name}`), fullPage: true });
  });
}
