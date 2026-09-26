import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request, type Browser, type Page } from "@playwright/test";

/** W01–W11 live shots for docs/handover/workflow-artifacts.md. Fresh login per workflow.
 *  `CAPTURE_ARTIFACTS=1` after db:reset — skipped in the default e2e suite so CI does not
 *  mutate seed just to write PNGs. */
test.skip(!process.env.CAPTURE_ARTIFACTS, "set CAPTURE_ARTIFACTS=1 after db:reset");
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 90_000 });

const ARTIFACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/handover/artifacts");
const shot = (name: string) => path.join(ARTIFACTS, `${name}.png`);

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await request.newContext({ baseURL: "http://localhost:5173" });
  const res = await ctx.post("/api/auth/login", { data: { email, password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`${email} login failed: ${res.status()} ${await res.text()}`);
  const storageState = await ctx.storageState();
  await ctx.dispose();
  const browserCtx = await browser.newContext({ storageState });
  const page = await browserCtx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  return page;
}

async function switchProject(page: Page, name: string) {
  const sel = page.getByLabel("Select project");
  await expect(sel).toBeVisible();
  await sel.selectOption({ label: name });
}

test("W01 Start the day", async ({ browser }) => {
  const page = await loginAs(browser, "crm@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "My Day" })).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
  await main.getByRole("tab", { name: /Waiting on me/ }).click();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
  await expect(main.getByText(/Welcome call|KYC|handover|why/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w01-myday"), fullPage: true });

  await page.getByRole("button", { name: "Queues" }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await expect(page.locator("main").locator(".animate-pulse")).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "Claim", exact: true }).first().click();
  await expect(page.locator("main").getByText("Owned by Priya Nair").first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("w01-queues-claim"), fullPage: true });
});

test("W02 Find a home and hold a window", async ({ browser }) => {
  const page = await loginAs(browser, "sales@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Sales Desk", exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await page.screenshot({ path: shot("w02-inventory"), fullPage: true });

  await main.getByRole("tab", { name: "Prospects" }).click();
  await expect(main.getByText("Tanvi Joshi")).toBeVisible();
  await page.screenshot({ path: shot("w02-prospects"), fullPage: true });

  await main.getByRole("tab", { name: "Holds" }).click();
  await expect(main.getByText("V101")).toBeVisible();
  await page.screenshot({ path: shot("w02-holds"), fullPage: true });
});

test("W03 Hand a file from Sales to CRM", async ({ browser }) => {
  const page = await loginAs(browser, "superadmin@demo.pranava");
  await switchProject(page, "Pranava Meadows");
  await expect(page.getByLabel("Select project").locator("option:checked")).toHaveText("Pranava Meadows");
  await page.getByRole("button", { name: /^Handover/ }).first().click();
  await expect(page.getByRole("heading", { name: "Handover Packets" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Aditi Bansal")).toBeVisible();
  await page.screenshot({ path: shot("w03-packets-list"), fullPage: true });

  await page.getByRole("button", { name: /Aditi Bansal/ }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "Accept", exact: true })).toBeVisible({ timeout: 15_000 });
  await drawer.screenshot({ path: shot("w03-aditi-packet") });
});

test("W04 Keep the unit twin true", async ({ browser }) => {
  const page = await loginAs(browser, "site@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Unit Progress Control", exact: true })).toBeVisible();
  await main.getByRole("tab", { name: "Console", exact: true }).click();
  await expect(main.getByText("V110").first()).toBeVisible();
  await page.screenshot({ path: shot("w04-v110-console"), fullPage: true });

  await main.getByRole("tab", { name: "Changeability", exact: true }).click();
  await expect(main.getByRole("button", { name: /flexible/ }).or(main.getByText("V110")).first()).toBeVisible();
  await page.screenshot({ path: shot("w04-gates"), fullPage: true });

  await page.context().close();
  const sales = await loginAs(browser, "sales@demo.pranava");
  const salesDenied = await sales.request.put("/api/units/u_v110/progress/structure", {
    data: { state_code: "COMPLETE" },
  });
  expect(salesDenied.status(), "Sales must not write unit physics").toBe(403);
});

test("W05 Collect what is due", async ({ browser }) => {
  const page = await loginAs(browser, "accounts@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Collections" })).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
  await expect(main.getByText("Karthik Iyer").first()).toBeVisible();
  await page.screenshot({ path: shot("w05-collections"), fullPage: true });

  await main.getByText("Karthik Iyer").first().click();
  await expect(main.getByText(/overdue|due|reason|next/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w05-karthik-demands"), fullPage: true });

  const farhan = main.getByText("Farhan Qureshi").first();
  if (await farhan.isVisible().catch(() => false)) {
    await farhan.click();
  }
  await expect(page.getByText(/Farhan|cheque|bounce|V116/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w05-farhan"), fullPage: true });
});

test("W06 Work a change request", async ({ browser }) => {
  const page = await loginAs(browser, "superadmin@demo.pranava");
  await switchProject(page, "Pranava Meadows");
  await page.getByRole("button", { name: /Customisation Desk|^Custom\.$/ }).first().click();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Customisation desk", exact: true })).toBeVisible();
  await expect(main.getByText(/CR-000001|Nisha|MT1-201|AWAITING_CUSTOMER/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w06-desk"), fullPage: true });

  await main.getByRole("button", { name: /CR-000001|Kitchen island|Nisha/i }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: shot("w06-cr-drawer"), fullPage: true });
});

test("W07 Make the Agreement of Sale", async ({ browser }) => {
  const page = await loginAs(browser, "superadmin@demo.pranava");
  await switchProject(page, "Pranava Meadows");
  await page.getByRole("button", { name: /Legal Documents|^Legal$/ }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Document factory" })).toBeVisible();
  await expect(page.locator("main").getByText("Kavya Iyer")).toBeVisible();
  await page.screenshot({ path: shot("w07-kavya-draft"), fullPage: true });
});

test("W08 Register the home", async ({ browser }) => {
  const page = await loginAs(browser, "superadmin@demo.pranava");
  await switchProject(page, "Pranava Meadows");
  await page.getByRole("button", { name: /Legal Documents|^Legal$/ }).first().click();
  await page.getByRole("tab", { name: "Registration Desk" }).click();
  await expect(page.locator("main").getByRole("heading", { name: "Registration" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main").getByText(/Deepak/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w08-deepak-slot"), fullPage: true });

  await switchProject(page, "East Crest");
  await page.getByRole("button", { name: /Legal Documents|^Legal$/ }).first().click();
  await page.getByRole("tab", { name: "Registration Desk" }).click();
  await expect(page.locator("main").getByText(/Anjali/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w08-anjali-blocked"), fullPage: true });
});

test("W09 Issue keys — or stop on a hard gate", async ({ browser }) => {
  const page = await loginAs(browser, "qa@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "QA & handover" })).toBeVisible();
  await expect(main.getByText(/Ishaan Gupta/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w09-ishaan"), fullPage: true });

  await expect(main.getByText(/Vivek Sharma/i).first()).toBeVisible();
  const vivekCase = main
    .getByText("Vivek Sharma · Villa V119", { exact: true })
    .or(main.getByText(/Vivek Sharma/i))
    .last()
    .locator("xpath=ancestor::div[contains(@class,'rounded-card') or contains(@class,'rounded-xl')][1]");
  if (await vivekCase.getByRole("button", { name: "Open case" }).count()) {
    await vivekCase.getByRole("button", { name: "Open case" }).click();
    await expect(page.getByRole("dialog").getByText(/CRITICAL|Not eligible|snag/i).first()).toBeVisible();
  }
  await page.screenshot({ path: shot("w09-vivek-blocked"), fullPage: true });

  if (await page.getByRole("dialog").count()) {
    await page.keyboard.press("Escape");
  }
  await expect(main.getByRole("heading", { name: "QA exception queue" })).toBeVisible();
  await page.screenshot({ path: shot("w09-exceptions"), fullPage: true });
});

test("W10 Life after keys", async ({ browser }) => {
  const page = await loginAs(browser, "fm@demo.pranava");
  await expect(page.locator("main").getByRole("heading", { name: "After keys" })).toBeVisible();
  const row = page.getByRole("row", { name: /V113/ });
  await expect(row).toBeVisible();
  await page.screenshot({ path: shot("w10-rohan-after"), fullPage: true });

  await row.click();
  await expect(page.getByRole("heading", { name: "Defect-liability windows" })).toBeVisible();
  await expect(page.getByText("Day 7")).toBeVisible();
  await page.getByRole("tab", { name: "Passport" }).click();
  await page.screenshot({ path: shot("w10-passport"), fullPage: true });
});

test("W11 Act from the Control Tower", async ({ browser }) => {
  const page = await loginAs(browser, "management@demo.pranava");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Control tower" })).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
  await expect(main.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("w11-tower"), fullPage: true });

  await main.getByRole("button", { name: "Decision pack" }).first().click();
  await expect(main.getByText(/Owner:|Depends on/i).first()).toBeVisible();
  await page.screenshot({ path: shot("w11-act"), fullPage: true });
});
