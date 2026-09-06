import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 06-timeline-sla-engine.md Screens: Journey Timeline + Project Journey Control — targeted spec
// for this slice's new surfaces at 3 breakpoints, not the full suite (same convention as
// sla-policies.spec.ts/journey-template-studio.spec.ts). Also the regression guard for a real
// bug found live at 375px this slice: `PageHeader`'s actions wrapper (`shrink-0`, no
// `flex-wrap`) let a Segmented + up to 3 buttons overflow the viewport horizontally
// (`document.body.scrollWidth` 430 vs `clientWidth` 360) — fixed in `packages/ui`'s
// `PageHeader.tsx`, asserted directly below since jsdom/RTL cannot measure layout at all.
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

// nav.ts renders `label` ("Journey Control"/"CRM / RM") in the desktop sidebar but the shorter
// `short` ("Journeys"/"CRM") in the mobile header bar (Workspace.tsx) — match either.
async function openJourneyControl(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Journey Control|Journeys/ }).first().click();
  await expect(page.getByRole("heading", { name: "Project Journey Control" })).toBeVisible();
}

for (const s of sizes) {
  test(`Project Journey Control @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await openJourneyControl(page);
    // Settle past the loading Table state before screenshotting/measuring.
    await expect(page.getByText(/No journeys have started for this project yet\.|Couldn't load journeys for this project\./).or(page.locator("table"))).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`journey-control-${s.name}`), fullPage: true });
  });
}

// Real Journey Timeline data only exists for a booking that has actually gone through
// sales_handover.accepted (this slice's own live-verification created one — Anita Sharma / Villa
// V101 — via a real Sales -> CRM-accept flow, since seeded "active customers" are inserted
// directly and bypass that event). Rather than hardcode that name and go stale the moment the dev
// DB is reseeded, walk the real CRM customer list and Customer360's real "View journey" buttons
// until a populated timeline is found — same resilience pattern as myday.spec.ts's tab loop. If
// none is ever found (a freshly reseeded DB with no live-verified journey yet), the honest empty
// state is asserted instead; either way this proves the wiring and the layout invariant.
async function openFirstAvailableJourneyTimeline(page: Page): Promise<"populated" | "empty" | "none"> {
  await page.goto("/");
  await page.getByRole("button", { name: /CRM \/ RM|^CRM$/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();

  const activeCustomers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Active customers" }) });
  // `customers` loads async (api.listCustomers()) after the static heading is already on screen —
  // wait for that fetch to settle (a real button or the honest empty-state text) before counting,
  // otherwise this races the network and always sees 0.
  await expect(activeCustomers.getByRole("button").first().or(activeCustomers.getByText("No customers yet"))).toBeVisible();
  const customerButtons = activeCustomers.getByRole("button");
  const customerCount = await customerButtons.count();
  if (customerCount === 0) return "none";

  // Leaves the page on the LAST booking's own render (populated, or its honest empty state) —
  // never navigates back after the final attempt — so a caller can screenshot/measure/assert the
  // real JourneyTimeline screen either way, not the CRM list it started from.
  let sawAnyBooking = false;
  for (let i = 0; i < customerCount; i++) {
    await customerButtons.nth(i).click();
    // Customer360's own customer+bookings fetch is also async — "Bookings" only renders once it
    // settles, same race as the customer list above; wait for it before counting "View journey".
    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    const viewJourneyButtons = page.getByRole("button", { name: "View journey" });
    const bookingCount = await viewJourneyButtons.count();
    for (let j = 0; j < bookingCount; j++) {
      sawAnyBooking = true;
      await viewJourneyButtons.nth(j).click();
      await expect(page.getByRole("heading", { name: "Journey timeline" }).or(page.getByText("No journey has started for this booking yet."))).toBeVisible();
      if (await page.getByRole("heading", { name: "Journey timeline" }).isVisible()) return "populated";
      const isVeryLastAttempt = i === customerCount - 1 && j === bookingCount - 1;
      // Not the last thing we'll try: JourneyTimeline's own "Back" returns to Customer360 first,
      // then "Back to CRM" below returns to the customer list for the next customer to try.
      if (!isVeryLastAttempt) await page.getByRole("button", { name: "Back" }).click();
    }
    const isLastCustomer = i === customerCount - 1;
    if (!isLastCustomer) await page.getByRole("button", { name: "Back to CRM" }).click();
  }
  return sawAnyBooking ? "empty" : "none";
}

for (const s of sizes) {
  test(`Journey Timeline @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    const outcome = await openFirstAvailableJourneyTimeline(page);
    test.skip(outcome === "none", "No customers seeded in this dev DB to check for a journey.");
    // Honest limitation: JourneyTimeline.tsx only renders the overflow-prone PageHeader actions
    // (Segmented + up to 3 buttons — the thing bug #2 above was in) when `journey` is non-null, so
    // this assertion is a real regression guard only when `outcome === "populated"`; against a
    // freshly-reseeded DB with no live journey yet (`outcome === "empty"`) it's still run (cheap,
    // never wrong) but has nothing to catch since that header isn't on screen at all.
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: shot(`journey-timeline-${s.name}`), fullPage: true });
  });
}

// Deterministic wiring check (first customer, first booking) rather than the exhaustive search
// above — this only needs to prove the button navigates to a real JourneyTimeline render for that
// booking's id, which is true whether or not that particular booking has a journey yet.
test("Customer 360 'View journey' opens the real timeline for that booking", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /CRM \/ RM|^CRM$/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();

  const activeCustomers = page.locator("section").filter({ has: page.getByRole("heading", { name: "Active customers" }) });
  await expect(activeCustomers.getByRole("button").first().or(activeCustomers.getByText("No customers yet"))).toBeVisible();
  const customerButtons = activeCustomers.getByRole("button");
  test.skip((await customerButtons.count()) === 0, "No customers seeded in this dev DB.");

  await customerButtons.first().click();
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
  const viewJourneyButtons = page.getByRole("button", { name: "View journey" });
  test.skip((await viewJourneyButtons.count()) === 0, "First customer has no bookings to check.");

  await viewJourneyButtons.first().click();
  // Either a real populated timeline or the honest empty state — either way proves "View journey"
  // genuinely navigates to JourneyTimeline for that specific booking, not a stub/dead link.
  await expect(
    page.getByRole("heading", { name: "Journey timeline" }).or(page.getByText("No journey has started for this booking yet."))
  ).toBeVisible();
});
