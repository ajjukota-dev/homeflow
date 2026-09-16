import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 29-communications.md Screens: Customer 360's Communications tab (log/send/publish) and a
// reusable Notes panel — the interactive UI this spec's own backend build note flagged as
// missing. Drives the seeded customer Rohan Desai / Villa V113 (already ACCEPTED in seed data,
// so no booking+accept dance is needed — other e2e specs touch his Commitments/Handover data,
// none touch Communications, so this file's own mutations don't collide) rather than a fresh
// booking: a fresh `bookVilla()` call fires the real booking.created welcome-draft event
// (18 §12), which pollutes customer-updates.spec.ts's own "exactly one draft" assumption once
// this file sorts ahead of it alphabetically — found the hard way, first draft of this file used
// bookVilla and broke that other file's suite.
test("log a call, send a freeform email, publish it to the portal, and add an internal note", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
  await page.getByRole("button", { name: /Rohan Desai/ }).click();
  await page.getByRole("tab", { name: "Communications" }).click();
  await expect(page.getByText("No communications logged yet.")).toBeVisible();

  // Log a call
  await page.getByRole("button", { name: "Log a call/meeting" }).click();
  await page.getByRole("textbox", { name: "What was discussed" }).fill("Confirmed the site visit slot.");
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText("Confirmed the site visit slot.")).toBeVisible();
  await expect(page.getByText("Internal only")).toBeVisible();

  // Send a freeform email
  await page.getByRole("button", { name: "Send email" }).click();
  await page.getByRole("radio", { name: "Write freeform" }).click();
  await page.getByRole("textbox", { name: "To" }).fill("rohan.desai@example.com");
  await page.getByRole("textbox", { name: "Subject" }).fill("Welcome");
  await page.getByRole("textbox", { name: "Message" }).fill("Welcome to East Crest!");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Welcome to East Crest!")).toBeVisible();

  await page.screenshot({ path: shot("communications-tab-desktop"), fullPage: true });

  // Publish the email to the portal — confirmation dialog states what the customer will see
  await page.getByRole("button", { name: "Publish to portal" }).first().click();
  await expect(page.getByRole("dialog", { name: "Publish to the customer portal" })).toBeVisible();
  await expect(page.getByText("This will appear in the customer's portal immediately")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Customer can see this").first()).toBeVisible();

  // Internal notes — reusable panel, never customer-visible
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("textbox", { name: /Add an internal note/ }).fill("Interested in a home theatre add-on.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Interested in a home theatre add-on.")).toBeVisible();
});

// 29-communications.md rule 4 — the guardrail-blocked UX shows the last-sent facts, not just a
// disabled button, and CRM/Management can override with a reason. Reuses the customer this
// file's own first test just emailed (that freeform send has no template_id, so it doesn't
// count toward the guardrail — the templated send below is this customer's first GENERAL send).
test("Policy Studio: create, submit and approve a template; guardrail blocks a second send until overridden", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Policy Studio/ }).click();
  await page.getByRole("button", { name: "Communication templates" }).click();
  await page.getByRole("button", { name: "+ New template" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill("E2E_GENERAL_NOTE");
  await page.getByRole("textbox", { name: "Body" }).fill("A plain note with no merge fields.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  // Lower the GENERAL guardrail to 1/30 days as MANAGEMENT so the next templated send blocks.
  const mgmtCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mgmt = await mgmtCtx.newPage();
  await mgmt.goto("/");
  await mgmt.getByLabel("Email").fill("management@demo.pranava");
  await mgmt.getByLabel("Password").fill("Demo@2026");
  await mgmt.getByRole("button", { name: "Sign in" }).click();
  await expect(mgmt.getByRole("heading", { name: "Control tower" })).toBeVisible();
  await mgmt.getByRole("button", { name: /^Policy Studio/ }).click();
  await mgmt.getByRole("button", { name: "Frequency guardrails" }).click();
  await mgmt.getByRole("row", { name: /^GENERAL/ }).getByRole("button", { name: "Edit" }).click();
  await mgmt.getByRole("textbox", { name: "max_per_customer_per_window" }).fill("1");
  await mgmt.getByRole("button", { name: "Save & publish" }).click();
  await expect(mgmt.getByRole("row", { name: /^GENERAL/ }).getByRole("cell", { name: "1", exact: true })).toBeVisible();
  await mgmtCtx.close();

  // As CRM: first templated send to Rohan succeeds, second (this one) hits the freshly-lowered cap.
  const crmCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const crm = await crmCtx.newPage();
  await crm.goto("/");
  await crm.getByLabel("Email").fill("crm@demo.pranava");
  await crm.getByLabel("Password").fill("Demo@2026");
  await crm.getByRole("button", { name: "Sign in" }).click();
  await crm.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await expect(crm.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
  await crm.getByRole("button", { name: /Rohan Desai/ }).click();
  await crm.getByRole("tab", { name: "Communications" }).click();

  async function sendTemplated() {
    await crm.getByRole("button", { name: "Send email" }).click();
    await crm.getByRole("textbox", { name: "To" }).fill("rohan.desai@example.com");
    await crm.getByRole("combobox", { name: "Template" }).click();
    await crm.getByRole("option", { name: /E2E_GENERAL_NOTE/ }).click();
  }

  await sendTemplated();
  // Wait for the preview fetch to resolve (it and the guardrail-status fetch fire together) before
  // asserting the guardrail panel's absence, so the assertion can't pass on a still-loading drawer.
  await expect(crm.getByText("A plain note with no merge fields.").first()).toBeVisible();
  await expect(crm.getByText("Frequency guardrail blocked")).not.toBeVisible();
  await crm.getByRole("button", { name: "Send" }).click();
  await expect(crm.getByText("A plain note with no merge fields.").first()).toBeVisible();

  await sendTemplated();
  await expect(crm.getByText("Frequency guardrail blocked")).toBeVisible();
  await expect(crm.getByRole("button", { name: "Send" })).toBeDisabled();
  await crm.screenshot({ path: shot("guardrail-blocked-desktop") });

  await crm.getByRole("textbox", { name: "Override reason" }).fill("Customer explicitly asked for this in writing.");
  await expect(crm.getByRole("button", { name: "Send" })).toBeEnabled();
  await crm.getByRole("button", { name: "Send" }).click();
  await expect(crm.getByText("A plain note with no merge fields.").nth(1)).toBeVisible();
  await crmCtx.close();
});

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
for (const s of sizes) {
  test(`Communications tab renders at @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
    await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
    await page.getByRole("button", { name: /Rohan Desai/ }).click();
    await page.getByRole("tab", { name: "Communications" }).click();
    await expect(page.getByText("Log a call/meeting")).toBeVisible();
    await page.screenshot({ path: shot(`communications-${s.name}`), fullPage: true });
  });
}
