import { test, expect } from "@playwright/test";

const shot = (name: string) => `e2e/__screenshots__/${name}.png`;

// 31-intelligence.md Screens — ScoreCards (Booking 360), Suggestions inbox (per role, accept/
// reject), Studio LLM usage. Reuses Rohan Desai / Villa V113 — the same shared CRM fixture
// communications.spec.ts and commitments.spec.ts already mutate (no exact-count assertion on his
// commitments/communications lists anywhere in this suite, checked before reusing him) — a fresh
// booking would fire a real booking.created welcome-draft event that pollutes customer-updates.
// spec.ts's own "exactly one draft" assumption, the same collision that file's own header already
// documents for any fresh bookVilla() call.
//
// Card locators below walk UP from a unique leaf element (a kind-specific button/textbox label)
// rather than filtering ancestor `div`s by text — a `div` filter matches every wrapping ancestor
// that also contains the same text (the whole Pending list, the TabsContent, ...), not just the
// one Card, and `.first()` over that set picks the outermost wrapper, not a single card. Found
// live: with 2 leftover pending COMMITMENT_DETECTION suggestions on an unreset dev DB, the broad
// filter's `.first()` resolved to the list wrapper containing both, and a text assertion inside
// it correctly failed as a strict-mode violation (2 matches, not 1) — the filter was never scoped
// to one card to begin with, this only surfaced once real state had more than one row.

test("Booking 360 shows Financial Health and Journey Risk score cards with drivers and confidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
  await page.getByRole("button", { name: /Rohan Desai/ }).click();
  await page.getByText("Villa V113").click();

  // Rule 7: "no score without drivers" — every ScoreCard renders a label, a confidence badge
  // (sibling of the label, ScoreCard.tsx's own header row), and at least one driver bullet in the
  // same card, never a bare number.
  const financialHeader = page.getByText("Financial Health", { exact: true }).locator("..");
  await expect(financialHeader.getByText(/confidence$/)).toBeVisible();
  const financialCard = financialHeader.locator("..");
  await expect(financialCard.locator("li").first()).toBeVisible();

  const journeyHeader = page.getByText("Journey Risk", { exact: true }).locator("..");
  await expect(journeyHeader.getByText(/confidence$/)).toBeVisible();
  const journeyCard = journeyHeader.locator("..");
  await expect(journeyCard.locator("li").first()).toBeVisible();

  await page.screenshot({ path: shot("booking-360-scorecards-desktop"), fullPage: true });
});

test("CRM detects a commitment from a communication, reviews and accepts it, and it becomes a real commitment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await expect(page.getByRole("heading", { name: "CRM · Relationship" })).toBeVisible();
  await page.getByRole("button", { name: /Rohan Desai/ }).click();
  await page.getByRole("tab", { name: "Communications" }).click();

  const marker = `E2E intelligence fixture ${Date.now()}`;
  await page.getByRole("button", { name: "Log a call/meeting" }).click();
  await page.getByRole("textbox", { name: "What was discussed" }).fill(`${marker}: promised a free chimney upgrade by next Friday.`);
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(marker)).toBeVisible();

  const row = page.locator("li").filter({ hasText: marker });
  await row.getByRole("button", { name: "Detect commitment" }).click();
  await expect(row.getByText("Suggestion created")).toBeVisible();

  // The fake LLM adapter (no OPENAI_API_KEY in this environment) never returns real fields —
  // proves rule 5's "CRM accepts/edits" holds even when the model produced nothing usable.
  // "Review & accept" is COMMITMENT_DETECTION's own unique button label (every other kind uses
  // plain "Accept"), so .first() safely lands on a real commitment-detection card even if other
  // pending suggestions of other kinds exist alongside it.
  await page.getByRole("button", { name: /^Suggestions/ }).first().click();
  await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();
  const acceptBtn = page.getByRole("button", { name: "Review & accept" }).first();
  const suggestionCard = acceptBtn.locator("../..");
  await expect(suggestionCard.getByText("No promise detected")).toBeVisible();
  await acceptBtn.click();

  await expect(page.getByRole("dialog", { name: "Accept detected commitment" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Accept detected commitment" });
  const commitmentText = `${marker}: free chimney upgrade promised — confirm delivery by next Friday.`;
  await dialog.getByRole("textbox", { name: "Description" }).fill(commitmentText);
  await page.screenshot({ path: shot("suggestions-accept-commitment-desktop") });
  await dialog.getByRole("button", { name: "Accept & create commitment" }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await page.getByRole("button", { name: /Rohan Desai/ }).click();
  await expect(page.getByText(commitmentText)).toBeVisible();
});

test("CRM summarizes a communication with an AI draft the fake adapter can't fill in, edits it, and accepts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(CRM \/ RM|CRM)/ }).first().click();
  await page.getByRole("button", { name: /Rohan Desai/ }).click();
  await page.getByRole("tab", { name: "Communications" }).click();

  const marker = `E2E summary fixture ${Date.now()}`;
  await page.getByRole("button", { name: "Log a call/meeting" }).click();
  await page.getByRole("textbox", { name: "What was discussed" }).fill(`${marker}: asked about the handover date.`);
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText(marker)).toBeVisible();

  const row = page.locator("li").filter({ hasText: marker });
  await row.getByRole("button", { name: "Summarize" }).click();
  await expect(row.getByText("Suggestion created")).toBeVisible();

  await page.getByRole("button", { name: /^Suggestions/ }).first().click();
  await page.getByRole("tab", { name: "Communication summary" }).click();
  // The override Textarea only renders for the 3 kinds whose accept step needs a human-supplied
  // text value (COMMUNICATION_SUMMARY/SENTIMENT/SNAG_ROOT_CAUSE_SUGGESTION) — its own aria-label
  // names the field, so it's unique to this tab's pending row without needing a card wrapper at all.
  const editBox = page.getByRole("textbox", { name: /Edit summary/ }).first();
  const card = editBox.locator("..");
  await expect(card.getByText("No summary produced")).toBeVisible();
  await expect(editBox).toHaveValue("");
  await expect(card.getByRole("button", { name: "Accept" })).toBeDisabled();
  await editBox.fill("Customer asked when handover is expected.");
  await expect(card.getByRole("button", { name: "Accept" })).toBeEnabled();
  await card.getByRole("button", { name: "Accept" }).click();
  // Accepting removes the row from the Pending filter (the default) — switch to Reviewed to see
  // it; re-queried by kind label since the Textarea itself unmounts once no longer pending, so
  // `card`'s own lazy locator chain (rooted at that now-gone textbox) can no longer resolve.
  await page.getByRole("radio", { name: "Reviewed" }).click();
  const reviewedCard = page.getByText("Communication summary", { exact: true }).locator("../..");
  await expect(reviewedCard.getByText("Accepted")).toBeVisible();
});

test("QA suggests a root cause for a snag, then rejects the AI draft from the Suggestions inbox", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const snagsResp = await page.request.get("/api/snags?project_id=p_eastcrest");
  const existingSnags: { unit_id: string }[] = (await snagsResp.json()).data;
  test.skip(existingSnags.length === 0, "No units with snags seeded in this dev DB.");
  const marker = `e2e root-cause fixture ${Date.now()}`;
  const createResp = await page.request.post("/api/snags", {
    data: { unit_id: existingSnags[0].unit_id, room: "BATHROOM_1", category: "PLUMBING", severity: "MINOR", description: marker },
  });
  expect(createResp.ok(), `create failed: ${await createResp.text()}`).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: /^QA/ }).first().click();
  const snagRow = page.locator("li").filter({ hasText: marker });
  // "Suggest root cause" has no visible success confirmation (unlike the Communications panel's
  // triggers) — wait on the real POST /api/llm/tasks response rather than any UI text, or the
  // test can navigate to Suggestions before the suggestion actually exists server-side (found
  // live: the request completes fine, just after the test had already moved on and asserted
  // "no pending suggestions").
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/llm/tasks") && r.request().method() === "POST"),
    snagRow.getByRole("button", { name: "Suggest root cause" }).click(),
  ]);

  await page.getByRole("button", { name: /^Suggestions/ }).first().click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/llm/tasks?kind=SNAG_ROOT_CAUSE_SUGGESTION")),
    page.getByRole("tab", { name: "Snag root-cause suggestion" }).click(),
  ]);
  const editBox = page.getByRole("textbox", { name: /Edit root cause/ }).first();
  const card = editBox.locator("..");
  await expect(card.getByText("No root cause suggested")).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("radio", { name: "Reviewed" }).click();
  const reviewedCard = page.getByText("Snag root-cause suggestion", { exact: true }).locator("../..");
  await expect(reviewedCard.getByText("Rejected")).toBeVisible();
});

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];
for (const s of sizes) {
  test(`Suggestions inbox renders at @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto("/");
    await page.getByRole("button", { name: /^Suggestions/ }).first().click();
    await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();
    await page.screenshot({ path: shot(`suggestions-inbox-${s.name}`), fullPage: true });
  });
}

test("Policy Studio: LLM budget & usage tab shows real month-to-date numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Policy Studio/ }).click();
  await page.getByRole("button", { name: "LLM budget" }).click();
  await expect(page.getByRole("heading", { name: "LLM budget & usage" })).toBeVisible();
  await expect(page.getByText("Calls this month")).toBeVisible();
  await expect(page.getByText("LLM_MONTHLY_BUDGET_INR")).toBeVisible();
  await page.screenshot({ path: shot("studio-llm-usage-desktop"), fullPage: true });
});
