import { test, expect, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

async function bookVilla(page: Page, applicant: string, phone: string, pan: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Sales/ }).first().click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await page.getByRole("button", { name: "Book this villa" }).first().click();
  await expect(page.getByRole("heading", { name: /Book Villa/ })).toBeVisible();
  await page.getByPlaceholder("e.g. Anita Sharma").fill(applicant);
  await page.getByPlaceholder("10-digit mobile").fill(phone);
  await page.getByPlaceholder("ABCDE1234F").fill(pan);
  await page.getByPlaceholder(/00,000/).fill("8500000");
  await page.getByRole("checkbox").first().waitFor();
  for (const doc of await page.getByRole("checkbox").all()) await doc.click();
  await page.getByRole("button", { name: "Submit to CRM" }).click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
}

// 29-communications.md Screens: Customer 360's Communications tab (log/send/publish) and a
// reusable Notes panel — the interactive UI this spec's own backend build note flagged as
// missing. Drives a real booking through Customer 360 rather than a seeded fixture, same
// precedent as customer-updates.spec.ts.
test("log a call, send a freeform email, publish it to the portal, and add an internal note", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const applicant = "Comms Flow Test";
  await bookVilla(page, applicant, "9876500022", "COMTK1234N");

  await page.getByRole("button", { name: new RegExp(applicant) }).click();
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
  await page.getByRole("textbox", { name: "To" }).fill("comms.flow@example.com");
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
// disabled button, and CRM/Management can override with a reason. Reuses the customer this file's
// own first test just created (its email counts toward the GENERAL purpose's guardrail).
test("Policy Studio: create, submit and approve a template; guardrail blocks a second send until overridden", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Policy Studio/ }).click();
  await page.getByRole("button", { name: "Communication templates" }).click();
  await page.getByRole("button", { name: "+ New template" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill("E2E_GENERAL_NOTE");
  await page.getByRole("textbox", { name: "Body" }).fill("A plain note with no merge fields.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Draft")).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved")).toBeVisible();

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

  // As CRM, go send this template to the customer from the first test — first send succeeds,
  // is now hitting the freshly-lowered cap, so this is the send that gets blocked.
  const crmCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const crm = await crmCtx.newPage();
  await crm.goto("/");
  await crm.getByLabel("Email").fill("crm@demo.pranava");
  await crm.getByLabel("Password").fill("Demo@2026");
  await crm.getByRole("button", { name: "Sign in" }).click();
  await crm.getByRole("button", { name: new RegExp("Comms Flow Test") }).click();
  await crm.getByRole("tab", { name: "Communications" }).click();
  await crm.getByRole("button", { name: "Send email" }).click();
  await crm.getByRole("textbox", { name: "To" }).fill("comms.flow@example.com");
  await crm.getByRole("combobox", { name: "Template" }).click();
  await crm.getByRole("option", { name: /E2E_GENERAL_NOTE/ }).click();
  await expect(crm.getByText("Frequency guardrail blocked")).toBeVisible();
  await expect(crm.getByRole("button", { name: "Send" })).toBeDisabled();
  await crm.screenshot({ path: shot("guardrail-blocked-desktop") });

  await crm.getByRole("textbox", { name: "Override reason" }).fill("Customer explicitly asked for this in writing.");
  await expect(crm.getByRole("button", { name: "Send" })).toBeEnabled();
  await crm.getByRole("button", { name: "Send" }).click();
  await expect(crm.getByText("A plain note with no merge fields.")).toBeVisible();
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
    await page.getByRole("button", { name: new RegExp("Comms Flow Test") }).click();
    await page.getByRole("tab", { name: "Communications" }).click();
    await expect(page.getByText("Log a call/meeting")).toBeVisible();
    await page.screenshot({ path: shot(`communications-${s.name}`), fullPage: true });
  });
}
