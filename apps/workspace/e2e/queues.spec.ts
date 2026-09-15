import { test, expect, request, type Browser, type Page } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 10-universal-action.md Screens: "Departmental queues". Locators on main; { exact: true }
// on short verbs (Claim / Retry). Superadmin storageState defaults to the Sales tab.
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

async function waitForSettled(page: Page) {
  await expect(page.getByRole("tabpanel").locator(".animate-pulse")).toHaveCount(0);
}

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await request.newContext({ baseURL: "http://localhost:5173" });
  const res = await ctx.post("/api/auth/login", { data: { email, password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`${email} login failed: ${res.status()} ${await res.text()}`);
  const storageState = await ctx.storageState();
  await ctx.dispose();
  const browserCtx = await browser.newContext({ storageState });
  const page = await browserCtx.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  return page;
}

async function createUnassignedCrmAction(page: Page, title: string): Promise<void> {
  const res = await page.request.post("/api/actions", {
    data: {
      type: "exec_simple",
      title,
      source_module: "queues_e2e",
      source_entity_type: "test",
      source_entity_id: `q_${Date.now()}`,
      owner_role: "CRM",
      project_id: "p_eastcrest",
    },
  });
  if (!res.ok()) throw new Error(`create action failed: ${res.status()} ${await res.text()}`);
}

async function openQueues(page: Page) {
  await page.getByRole("button", { name: "Queues" }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await waitForSettled(page);
}

for (const s of sizes) {
  test(`Queues @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: "Queues" }).first().click();
    await expect(page.locator("main").getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
    await waitForSettled(page);
    await page.screenshot({ path: shot(`queues-${s.name}`), fullPage: true });
  });
}

test("Queues: row click opens the action drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Queues" }).first().click();
  await expect(page.locator("main").getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await waitForSettled(page);

  const tabs = page.locator("main").getByRole("tab");
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    await waitForSettled(page);
    const row = page.getByRole("listitem").getByRole("button").first();
    if ((await row.count()) === 0) continue;
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.getByLabel("Close").click();
    await expect(dialog).toHaveCount(0);
    return;
  }
});

test("Queues: department user claims an unassigned row from main", async ({ browser }) => {
  const page = await loginAs(browser, "crm@demo.pranava");
  const title = `E2E claim ${Date.now()}`;
  await createUnassignedCrmAction(page, title);
  await openQueues(page);
  const main = page.locator("main");
  await expect(main.getByText(title)).toBeVisible();
  await main.getByRole("button", { name: "Claim", exact: true }).first().click();
  await waitForSettled(page);
  await expect(main.getByText(title)).toBeVisible();
  await expect(main.getByText(/Owned by /)).toBeVisible();
});

test("Queues: management reassigns from main", async ({ browser }) => {
  const page = await loginAs(browser, "management@demo.pranava");
  const title = `E2E reassign ${Date.now()}`;
  await createUnassignedCrmAction(page, title);
  await openQueues(page);
  const main = page.locator("main");
  await main.getByRole("tab", { name: "CRM / RM" }).click();
  await waitForSettled(page);
  await expect(main.getByText(title)).toBeVisible();
  const row = main.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("checkbox").click();
  await main.getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await main.getByRole("button", { name: /Reassign/ }).click();
  await waitForSettled(page);
  await expect(main.getByRole("status")).toBeVisible();
  await expect(main.getByText(/Reassigned 1 action/)).toBeVisible();
});

test("Queues: empty state is not a spinner", async ({ page }) => {
  await page.route("**/api/actions?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Queues" }).first().click();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await waitForSettled(page);
  await expect(main.getByText(/No open actions in/)).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
});

test("Queues: error state is not a spinner", async ({ page }) => {
  await page.route("**/api/actions?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ errors: [{ code: "internal", message: "boom" }] }),
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Queues" }).first().click();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Departmental Queues" })).toBeVisible();
  await expect(main.getByText("Couldn't load this queue.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(main.locator(".animate-pulse")).toHaveCount(0);
});
