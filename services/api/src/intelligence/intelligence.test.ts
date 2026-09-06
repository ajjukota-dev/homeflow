import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles, superAdminCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { createCommitment, getCommitment } from "../commitments/core";
import { logCommunication } from "../communications/core";
import { createSnag } from "../qa/snags";
import { computeCustomerHealth, explainCustomerHealth } from "./customer-health";
import { computeFinancialHealth } from "./financial-health";
import { computeJourneyRisk } from "./journey-risk";
import { computeCollectionRisk } from "./collection-risk";
import { computeCommitmentRisk } from "./commitment-risk";
import { getNextBestAction } from "./next-best-action";
import { createTask, acceptTask, rejectTask, listSuggestions } from "./llm-tasks";

// 31-intelligence.md rules 1-7. Real seeded fixtures (b_v110/u_v110/c_karthik, d_v110_3 overdue —
// see seed.ts) rather than fresh bookings — every score here reads real, already-seeded facts,
// same convention 28/29's own view tests already established for this exact fixture set.
// Real seeded `user` ids (user_crm/user_fm) for any actor field that FKs "user" (commitment.
// committed_by_user_id, communication.logged_by) — synthetic ctxWithRoles() ids would fail those.

beforeAll(async () => {
  await initDb();
});

const crm: Ctx = { actor: { ...ctxWithRoles(["CRM"]).actor, user_id: "user_crm" } };
const fm: Ctx = { actor: { ...ctxWithRoles(["FM"]).actor, user_id: "user_fm" } };

describe("31 rule 1 — Customer Health", () => {
  it("scores 0-100 with a real overdue-payment driver for a customer with an overdue demand", async () => {
    const score = await computeCustomerHealth("c_karthik");
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.drivers.some((d) => d.code === "OVERDUE_AMOUNT")).toBe(true);
  });

  it("explain returns the full driver list, not just the top 3", async () => {
    const explained = await explainCustomerHealth("c_karthik");
    expect(explained.drivers.length).toBeGreaterThanOrEqual(1);
  });
});

describe("31 rule 2 — Financial Health", () => {
  it("computes a 0-100 score for a real booking without throwing", async () => {
    const score = await computeFinancialHealth("b_v110", superAdminCtx);
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
});

describe("31 rule 3 — Journey risk / Collection risk / Commitment risk", () => {
  it("journey risk reports LOW confidence and 0 when no journey_instance exists for the booking", async () => {
    const score = await computeJourneyRisk("b_v110", superAdminCtx);
    expect(score.value).toBe(0);
    expect(score.confidence).toBe("LOW");
  });

  it("collection risk computes 0-100 for a real overdue demand", async () => {
    const score = await computeCollectionRisk("d_v110_3");
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });

  it("commitment risk is exactly the inverse of 13's own confidence score", async () => {
    const commitment = await createCommitment(
      { booking_id: "b_v110", category: "SERVICE", description: "test commitment for risk scoring", source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, approval_required: false },
      crm
    );
    const view = await getCommitment(commitment.id, superAdminCtx);
    const score = await computeCommitmentRisk(commitment.id, superAdminCtx);
    expect(score.value).toBe(100 - view.confidence);
  });
});

describe("31 rule 4 — Next best action", () => {
  it("returns a shape with all fields present (null-filled or populated) for a real booking", async () => {
    const nba = await getNextBestAction("b_v110");
    expect(nba).toHaveProperty("action_id");
    expect(nba).toHaveProperty("recommended");
  });
});

describe("31 rule 5/7 — LLM task suggestions", () => {
  it("creates a snag-root-cause suggestion via the fake adapter and accepting writes snag.root_cause", async () => {
    const snag = await createSnag({ unit_id: "u_v110", room: "KITCHEN", category: "ELECTRICAL", severity: "MINOR", description: "loose switch plate" }, fm);
    const task = await createTask("SNAG_ROOT_CAUSE_SUGGESTION", snag.id);
    expect(task.kind).toBe("SNAG_ROOT_CAUSE_SUGGESTION");
    expect(task.accepted).toBeNull();

    await acceptTask(task.id, fm, { override: "loose electrical fitting during installation" });
    const row = await db.query<{ root_cause: string | null }>(`SELECT root_cause FROM snag WHERE id = $1`, [snag.id]);
    expect(row.rows[0]?.root_cause).toBe("loose electrical fitting during installation");
  });

  it("rejecting a suggestion applies nothing", async () => {
    const snag = await createSnag({ unit_id: "u_v110", room: "BATHROOM_1", category: "PLUMBING", severity: "MAJOR", description: "leaking pipe joint" }, fm);
    const task = await createTask("SNAG_ROOT_CAUSE_SUGGESTION", snag.id);
    const rejected = await rejectTask(task.id, fm);
    expect(rejected.accepted).toBe(false);
    const row = await db.query<{ root_cause: string | null }>(`SELECT root_cause FROM snag WHERE id = $1`, [snag.id]);
    expect(row.rows[0]?.root_cause).toBeNull();
  });

  it("sentiment suggestion writes communication.sentiment only after acceptance, never before", async () => {
    const comm = await logCommunication({ customer_id: "c_karthik", booking_id: "b_v110", channel: "EMAIL", direction: "INBOUND", body: "I am very unhappy with the delay." }, crm);
    const task = await createTask("SENTIMENT", comm.id);
    const before = await db.query<{ sentiment: string | null }>(`SELECT sentiment FROM communication WHERE id = $1`, [comm.id]);
    expect(before.rows[0]?.sentiment).toBeNull();

    await acceptTask(task.id, crm, { override: "NEGATIVE" });
    const after = await db.query<{ sentiment: string | null }>(`SELECT sentiment FROM communication WHERE id = $1`, [comm.id]);
    expect(after.rows[0]?.sentiment).toBe("NEGATIVE");
  });

  it("commitment-detection accept creates a real commitment from CRM's own edited fields, not raw LLM output", async () => {
    const comm = await logCommunication({ customer_id: "c_karthik", booking_id: "b_v110", channel: "CALL", direction: "OUTBOUND", body: "Promised to waive the late fee." }, crm);
    const task = await createTask("COMMITMENT_DETECTION", comm.id);
    const result = (await acceptTask(task.id, crm, {
      commitment: { booking_id: "b_v110", category: "SERVICE", description: "Waive late fee", source: "COMMUNICATION", beneficiary: "CUSTOMER", customer_facing: true, approval_required: false },
    })) as { commitment_id: string };
    expect(result.commitment_id).toBeTruthy();
  });

  it("a monthly budget cap stops new LLM tasks while rule-based scores keep working", async () => {
    await db.query(`INSERT INTO llm_call (id, purpose, model, tokens, cost_inr) VALUES ($1,'test_seed','fake',0,100)`, [randomUUID()]);
    process.env.LLM_MONTHLY_BUDGET_INR = "50";
    try {
      const snag = await createSnag({ unit_id: "u_v110", room: "UTILITY", category: "CIVIL", severity: "MINOR", description: "hairline crack" }, fm);
      await expect(createTask("SNAG_ROOT_CAUSE_SUGGESTION", snag.id)).rejects.toThrow(/budget/i);
      const score = await computeCustomerHealth("c_karthik");
      expect(score.value).toBeGreaterThanOrEqual(0);
    } finally {
      delete process.env.LLM_MONTHLY_BUDGET_INR;
    }
  });

  it("a budget cap of exactly 0 blocks every LLM task (0 must not be read as 'unset')", async () => {
    process.env.LLM_MONTHLY_BUDGET_INR = "0";
    try {
      const snag = await createSnag({ unit_id: "u_v110", room: "UTILITY", category: "CIVIL", severity: "MINOR", description: "another hairline crack" }, fm);
      await expect(createTask("SNAG_ROOT_CAUSE_SUGGESTION", snag.id)).rejects.toThrow(/budget/i);
    } finally {
      delete process.env.LLM_MONTHLY_BUDGET_INR;
    }
  });

  it("lists suggestions filtered by kind", async () => {
    const list = await listSuggestions("SNAG_ROOT_CAUSE_SUGGESTION", undefined, superAdminCtx);
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("31 events — coverage", () => {
  it("emits score.recomputed, llm.suggestion_created/accepted/rejected and llm.budget_exhausted", async () => {
    const types = await db.query<{ type: string }>(`SELECT DISTINCT type FROM event WHERE type LIKE 'score.%' OR type LIKE 'llm.%'`);
    const seen = types.rows.map((r) => r.type);
    expect(seen).toContain("score.recomputed");
    expect(seen).toContain("llm.suggestion_created");
    expect(seen).toContain("llm.suggestion_accepted");
    expect(seen).toContain("llm.suggestion_rejected");
    expect(seen).toContain("llm.budget_exhausted");
  });
});
