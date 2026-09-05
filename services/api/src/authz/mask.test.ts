import { beforeAll, describe, expect, it } from "vitest";
import { initDb } from "../db";
import { mask } from "./mask";
import type { Ctx } from "./types";

function ctxFor(roles: string[]): Ctx {
  return { actor: { user_id: "x", display_name: "x", kind: "STAFF", roles, project_ids: "ALL", default_project_id: null } };
}

// Rule 6 + p31 §26 "internal notes/financials remain internal": READ_STATUS_ONLY
// hides FINANCIAL, READ_LIMITED hides PII. One place (mask()), no per-handler branches.
describe("mask", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("LEGAL (READ_STATUS_ONLY on customer_financials) sees nulled amounts", async () => {
    const row = { id: "b1", agreement_value_inr: 9000000, agreement_value: 9000000, status: "active" };
    const masked = await mask(ctxFor(["LEGAL"]), "customer_financials", row);
    expect(masked.agreement_value_inr).toBeNull();
    expect(masked.agreement_value).toBeNull(); // un-suffixed twin also nulled
    expect(masked.status).toBe("active");
  });

  it("CRM (READ on customer_financials, footnote 2) sees actual amounts", async () => {
    const row = { id: "b1", agreement_value_inr: 9000000 };
    const masked = await mask(ctxFor(["CRM"]), "customer_financials", row);
    expect(masked.agreement_value_inr).toBe(9000000);
  });

  it("SITE (READ_LIMITED on customer_overview) has PII nulled", async () => {
    const row = { id: "c1", display_name: "Ananya Rao", phone: "9845000000", email: "a@x.com" };
    const masked = await mask(ctxFor(["SITE"]), "customer_overview", row);
    expect(masked.phone).toBeNull();
    expect(masked.email).toBeNull();
    expect(masked.display_name).toBe("Ananya Rao"); // not a sensitive field
  });

  it("CRM (WRITE on customer_overview) sees PII", async () => {
    const row = { id: "c1", phone: "9845000000" };
    const masked = await mask(ctxFor(["CRM"]), "customer_overview", row);
    expect(masked.phone).toBe("9845000000");
  });

  it("masks one level into nested milestones", async () => {
    const row = { id: "b1", milestones: [{ label: "m1", amount_inr: 100 }] };
    const masked = await mask(ctxFor(["LEGAL"]), "customer_financials", row);
    expect((masked.milestones as { amount_inr: number | null }[])[0].amount_inr).toBeNull();
  });

  it("does not mutate the original row", async () => {
    const row = { id: "b1", agreement_value_inr: 9000000 };
    await mask(ctxFor(["LEGAL"]), "customer_financials", row);
    expect(row.agreement_value_inr).toBe(9000000);
  });
});
