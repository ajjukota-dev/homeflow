import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// R1 (demo hardening, TODO.md §0): "E2E journeys for every existing feature ... Amarsh can
// log in as each role and walk Sales → CRM → Collections → QA → Handover → Portal on the URL,
// in the new design, with the journeys green." This walks every stage against the SAME two
// seeded villas (read-only — no mutation, so it's safe to run alongside the rest of the suite
// and doesn't fight the QA-handover test over who completes V112's handover):
//   - V110: an in-progress sale (Sales → CRM → Collections legs) — asserted by unit number,
//     not owning customer, since another test can re-point who owns it (see below)
//   - V113 / Rohan Desai: already handed over, DLP + warranty open (QA → Handover legs)
// The Portal leg lives in apps/my-pranava-home/e2e/auth.spec.ts ("customer signs in and lands
// on their booking's home screen") — a separate app/port, so a separate Playwright project.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

for (const s of sizes) {
  test(`Sale-to-handover journey @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");

    // Sales — the villa is listed and bookable.
    await page.getByRole("button", { name: /Sales/ }).first().click();
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByText("V110")).toBeVisible();
    await page.screenshot({ path: shot(`journey-sales-${s.name}`), fullPage: true });

    // CRM — V110's accepted file is visible as an active customer. Asserted on the unit
    // number, not the owning customer's name: admin-model.spec.ts's customer-merge test
    // can permanently re-point which customer owns V110 on a persisted dev DB (found while
    // writing this spec — see TODO.md's shared-DB e2e flakiness note), but the unit itself
    // never moves.
    await page.getByRole("button", { name: /CRM/ }).first().click();
    await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
    await expect(page.getByText("Villa V110")).toBeVisible();
    await page.screenshot({ path: shot(`journey-crm-${s.name}`), fullPage: true });

    // Collections — an overdue milestone is visible (never a raw/invalid date).
    await page.getByRole("button", { name: /Accounts|Cash/ }).first().click();
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page.getByText("Invalid Date")).toHaveCount(0);
    await page.screenshot({ path: shot(`journey-collections-${s.name}`), fullPage: true });

    // Legal — Rohan's executed AOS is on file.
    await page.getByRole("button", { name: /^Legal/ }).first().click();
    await expect(page.getByRole("heading", { name: "Document factory" })).toBeVisible();
    await expect(page.getByText("Rohan Desai")).toBeVisible();
    await page.screenshot({ path: shot(`journey-legal-${s.name}`), fullPage: true });

    // QA / Handover — Rohan's villa already shows "Keys issued".
    await page.getByRole("button", { name: /^QA/ }).first().click();
    await expect(page.getByRole("heading", { name: "QA & handover" })).toBeVisible();
    await expect(page.getByText("Keys issued").first()).toBeVisible();
    await page.screenshot({ path: shot(`journey-qa-${s.name}`), fullPage: true });

    // After keys — Rohan's open warranty case and active DLP window.
    await page.getByRole("button", { name: /^After/ }).first().click();
    await expect(page.getByRole("heading", { name: "After keys" })).toBeVisible();
    await expect(page.getByText(/month cover/i).first()).toBeVisible();
    await page.screenshot({ path: shot(`journey-after-keys-${s.name}`), fullPage: true });
  });
}
