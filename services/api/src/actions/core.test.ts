import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { withTx } from "../events";
import {
  createAction,
  createManualAction,
  claimAction,
  reassignAction,
  startAction,
  waitAction,
  blockAction,
  unblockAction,
  submitForApproval,
  approveAction,
  rejectAction,
  closeAction,
  cancelAction,
  addEvidence,
  verifyEvidence,
  setChecklistItem,
  setExternalReference,
  listActions,
  getQueue,
  getAction,
} from "./core";

// Universal Action (10-universal-action.md). action.*'s *_by/actor columns FK to "user"(id) —
// ctxWithRoles' fake "test_user" id doesn't exist there (same gap templates.test.ts's adminCtx
// and journey/instances.test.ts's local superAdminCtx already fixed). Two real, DIFFERENT users
// per relevant role are needed here specifically to prove the self-verify/self-approve guards
// reject same-actor and accept a different one — a single demo user per role (seed/users.ts)
// can't exercise that, so this file inserts its own tiny "user" fixtures.
let CRM_A: string, CRM_B: string, LEGAL_A: string, LEGAL_B: string, SITE_A: string;

beforeAll(async () => {
  await initDb();
  const userIds = ["act_crm_a", "act_crm_b", "act_legal_a", "act_legal_b", "act_site_a", "act_sales_a", "act_reg_a", "act_mgmt"];
  for (const id of userIds) {
    await db.query(`INSERT INTO "user" (id, email, display_name, status, kind) VALUES ($1,$2,$3,'ACTIVE','STAFF') ON CONFLICT (id) DO NOTHING`, [id, `${id}@test.local`, id]);
  }
  [CRM_A, CRM_B, LEGAL_A, LEGAL_B, SITE_A] = ["act_crm_a", "act_crm_b", "act_legal_a", "act_legal_b", "act_site_a"];
});

function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const crmA = () => ctxAs(CRM_A, ["CRM"]);
const crmB = () => ctxAs(CRM_B, ["CRM"]);
const legalA = () => ctxAs(LEGAL_A, ["LEGAL"]);
const legalB = () => ctxAs(LEGAL_B, ["LEGAL"]);
const siteA = () => ctxAs(SITE_A, ["SITE"]);

async function makeAction(type: string, overrides: Partial<Parameters<typeof createAction>[0]> = {}): Promise<string> {
  return withTx(undefined, (tx) =>
    createAction(
      {
        type,
        title: "Test action",
        source_module: "test",
        source_entity_type: "test_entity",
        source_entity_id: "te_1",
        owner_role: "CRM",
        origin: "AUTO",
        ...overrides,
      },
      tx
    )
  );
}

describe("actions/core: rule 1 — single creation path", () => {
  it("createAction applies action_type defaults and emits action.created", async () => {
    const id = await makeAction("exec_simple");
    const row = await db.query<{ status: string; priority: string; evidence_requirement: string; code: string }>(
      `SELECT status, priority, evidence_requirement, code FROM action WHERE id = $1`, [id]
    );
    expect(row.rows[0].status).toBe("New");
    expect(row.rows[0].priority).toBe("MEDIUM"); // action_type default, none supplied
    expect(row.rows[0].evidence_requirement).toBe("NONE");
    expect(row.rows[0].code).toMatch(/^ACT-\d{6}$/);
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'action' AND entity_id = $1 AND type = 'action.created'`, [id]);
    expect(ev.rows).toHaveLength(1);
  });

  it("rejects an unknown action_type", async () => {
    await expect(makeAction("not_a_real_type")).rejects.toThrow(/unknown action_type/);
  });

  it("createManualAction requires staff and stamps origin/created_by", async () => {
    const id = await createManualAction({ type: "exec_simple", title: "Manual", source_module: "test", source_entity_type: "test_entity", source_entity_id: "te_2", owner_role: "CRM" }, crmA());
    const row = await db.query<{ origin: string; created_by: string }>(`SELECT origin, created_by FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].origin).toBe("MANUAL");
    expect(row.rows[0].created_by).toBe(CRM_A);
  });
});

describe("actions/core: rule 3 — transitions", () => {
  it("New -> In Progress via start, auto-claims an unassigned action", async () => {
    const id = await makeAction("exec_simple");
    await startAction(id, crmA());
    const row = await db.query<{ status: string; owner_user_id: string }>(`SELECT status, owner_user_id FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("In Progress");
    expect(row.rows[0].owner_user_id).toBe(CRM_A);
  });

  it("In Progress <-> Waiting Internal/Customer requires a reason", async () => {
    const id = await makeAction("exec_simple");
    await startAction(id, crmA());
    await expect(waitAction(id, "Waiting Customer", "", crmA())).rejects.toThrow(/reason/);
    await waitAction(id, "Waiting Customer", "awaiting docs from customer", crmA());
    let row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Waiting Customer");
    await waitAction(id, "Waiting Internal", "escalated internally", crmA());
    row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Waiting Internal");
  });

  it("-> Blocked requires a reason, unblock returns to In Progress", async () => {
    const id = await makeAction("exec_simple");
    await startAction(id, crmA());
    await expect(blockAction(id, "", null, crmA())).rejects.toThrow(/reason/);
    await blockAction(id, "waiting on a dependency", null, crmA());
    let row = await db.query<{ status: string; blocking_reason: string }>(`SELECT status, blocking_reason FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Blocked");
    expect(row.rows[0].blocking_reason).toBe("waiting on a dependency");
    await unblockAction(id, crmA());
    row = await db.query<{ status: string; blocking_reason: string }>(`SELECT status, blocking_reason FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("In Progress");
    expect(row.rows[0].blocking_reason).toBeNull();
  });

  it("cancel: MANAGEMENT/SUPER_ADMIN always; the creator only while still New", async () => {
    const id = await createManualAction({ type: "exec_simple", title: "Cancel me", source_module: "test", source_entity_type: "test_entity", source_entity_id: "te_3", owner_role: "CRM" }, crmA());
    await expect(cancelAction(id, "", crmA())).rejects.toThrow(/reason/);
    await expect(cancelAction(id, "not needed anymore", ctxAs("act_crm_b", ["CRM"]))).rejects.toThrow(/forbidden|MANAGEMENT/i);
    await cancelAction(id, "not needed anymore", crmA()); // creator, still New
    const row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Cancelled");

    const id2 = await makeAction("exec_simple");
    await startAction(id2, crmA()); // no longer New
    await expect(cancelAction(id2, "reason", crmA())).rejects.toThrow(/forbidden|MANAGEMENT/i);
    await cancelAction(id2, "management override", ctxAs("act_mgmt", ["MANAGEMENT"]));
  });
});

describe("actions/core: rule 5 — owner queue, claim, reassign", () => {
  it("first claimer becomes owner; a second claim conflicts", async () => {
    const id = await makeAction("exec_simple");
    await claimAction(id, crmA());
    const row = await db.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].owner_user_id).toBe(CRM_A);
    await expect(claimAction(id, crmB())).rejects.toThrow(/already has an owner/);
  });

  it("claim requires the action_type's owner_role (or SUPER_ADMIN)", async () => {
    const id = await makeAction("exec_simple", { owner_role: "LEGAL" });
    await expect(claimAction(id, crmA())).rejects.toThrow(/requires role/);
    await claimAction(id, legalA());
  });

  it("reassign keeps history and is blocked while Ready for Approval", async () => {
    const id = await makeAction("exec_simple");
    await claimAction(id, crmA());
    await reassignAction(id, CRM_B, crmA());
    const row = await db.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].owner_user_id).toBe(CRM_B);
    const transitions = await db.query<{ reason: string }>(`SELECT reason FROM action_transition WHERE action_id = $1 ORDER BY at`, [id]);
    expect(transitions.rows.some((t) => t.reason?.includes("reassigned"))).toBe(true);

    const approvalId = await makeAction("exec_approval", { owner_role: "LEGAL", approver_role: "LEGAL" });
    await claimAction(approvalId, legalA());
    await startAction(approvalId, legalA());
    await submitForApproval(approvalId, legalA());
    await expect(reassignAction(approvalId, LEGAL_B, legalA())).rejects.toThrow(/Ready for Approval/);
  });
});

describe("actions/core: rule 4 — evidence gate on close", () => {
  it("EVIDENCE family (VERIFIED_ATTACHMENT): blocked until attached, blocked until verified, self-verify guard, then closes", async () => {
    const id = await makeAction("exec_evidence", { verifier_role: "CRM" });
    await claimAction(id, crmA());
    await expect(closeAction(id, undefined, crmA())).rejects.toThrow(/gate_blocked/);

    const evId = await addEvidence(id, "project/p1/action/1/f1.pdf", "kyc", crmA());
    let row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("In Progress"); // auto New -> In Progress on attach
    await expect(closeAction(id, undefined, crmA())).rejects.toThrow(/not verified/);

    await expect(verifyEvidence(evId, "VERIFIED", undefined, crmA())).rejects.toThrow(/self-verify/); // uploader == verifier
    await verifyEvidence(evId, "VERIFIED", "looks good", crmB());
    await closeAction(id, "done", crmA());
    row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Closed");
  });

  it("CHECKLIST: required items must all be checked", async () => {
    const id = await makeAction("exec_checklist", {
      owner_role: "SITE",
      checklist: [{ label: "civil" }, { label: "electrical" }, { label: "optional note", required: false }],
    });
    await claimAction(id, siteA());
    await expect(closeAction(id, undefined, siteA())).rejects.toThrow(/gate_blocked/);
    const items = await db.query<{ id: string; label: string }>(`SELECT id, label FROM action_checklist_item WHERE action_id = $1`, [id]);
    for (const item of items.rows.filter((i) => i.label !== "optional note")) {
      await setChecklistItem(id, item.id, true, siteA());
    }
    await closeAction(id, undefined, siteA());
    const row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Closed");
  });

  it("EXTERNAL_REF: requires a reference before close", async () => {
    const id = await makeAction("exec_external", { owner_role: "REGISTRATION" });
    await claimAction(id, ctxAs("act_reg_a", ["REGISTRATION"]));
    await expect(closeAction(id, undefined, ctxAs("act_reg_a", ["REGISTRATION"]))).rejects.toThrow(/gate_blocked/);
    await setExternalReference(id, "SRO-SLOT-12345", ctxAs("act_reg_a", ["REGISTRATION"]));
    await closeAction(id, undefined, ctxAs("act_reg_a", ["REGISTRATION"]));
  });

  it("VERIFICATION family: closes with zero evidence rows — a verifier_role holder who is not the owner (doer)", async () => {
    const id = await makeAction("exec_verification", { owner_role: "SALES", verifier_role: "CRM" });
    const sales = ctxAs("act_sales_a", ["SALES"]);
    await claimAction(id, sales);
    // Owner lacks verifier_role entirely.
    await expect(closeAction(id, undefined, sales)).rejects.toThrow(/requires role CRM/);
    // A CRM-role user who is NOT the owner closes directly — no evidence row involved at all.
    await closeAction(id, "confirmed", crmA());
    const row = await db.query<{ status: string }>(`SELECT status FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Closed");
    const evCount = await db.query<{ count: string }>(`SELECT count(*)::text FROM action_evidence WHERE action_id = $1`, [id]);
    expect(evCount.rows[0].count).toBe("0");
  });

  it("VERIFICATION family: the owner themself, even holding verifier_role, cannot self-verify-close", async () => {
    const id = await makeAction("exec_verification", { owner_role: "CRM", verifier_role: "CRM" });
    await claimAction(id, crmA());
    await expect(closeAction(id, undefined, crmA())).rejects.toThrow(/self-verify/);
    await closeAction(id, undefined, crmB()); // a different CRM user closes fine
  });
});

describe("actions/core: rule 4 — APPROVAL family (self-approve guard)", () => {
  it("submit-for-approval only from In Progress and only APPROVAL family; approve/reject gated on approver_role != submitter", async () => {
    const id = await makeAction("exec_approval", { owner_role: "LEGAL", approver_role: "LEGAL" });
    const simpleId = await makeAction("exec_simple");
    await startAction(simpleId, crmA());
    await expect(submitForApproval(simpleId, crmA())).rejects.toThrow(/APPROVAL-family/);

    await claimAction(id, legalA());
    await startAction(id, legalA());
    await submitForApproval(id, legalA());
    let row = await db.query<{ status: string; submitted_by: string | null }>(`SELECT status, submitted_by FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Ready for Approval");
    expect(row.rows[0].submitted_by).toBe(LEGAL_A);

    await expect(approveAction(id, undefined, legalA())).rejects.toThrow(/self-approve/); // same submitter
    await rejectAction(id, "needs rework", legalA()); // MANAGEMENT/approver_role/SA may reject; legalA has approver_role
    row = await db.query<{ status: string; submitted_by: string | null }>(`SELECT status, submitted_by FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("In Progress");
    expect(row.rows[0].submitted_by).toBeNull();

    await submitForApproval(id, legalA());
    await approveAction(id, "approved", legalB()); // different LEGAL user
    row = await db.query<{ status: string; submitted_by: string | null }>(`SELECT status, submitted_by FROM action WHERE id = $1`, [id]);
    expect(row.rows[0].status).toBe("Closed");
  });
});

describe("actions/core: reads", () => {
  it("listActions filters by owner_role/status, getQueue reads the departmental_queue view", async () => {
    await makeAction("exec_simple", { owner_role: "CUSTOMISATION" });
    const list = await listActions({ owner_role: "CUSTOMISATION", status: "New" }, crmA());
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.owner_role === "CUSTOMISATION" && a.status === "New")).toBe(true);

    const queue = await getQueue("CUSTOMISATION", crmA());
    expect(queue.some((q) => q.status === "New" && q.count >= 1)).toBe(true);
  });

  it("getAction returns full drawer detail: family, checklist, evidence, transition history", async () => {
    const id = await makeAction("exec_simple", { owner_role: "LEGAL", checklist: [{ label: "Step 1", required: true }] });
    await startAction(id, legalA());
    await addEvidence(id, "k1", "photo", legalA());

    const detail = await getAction(id, crmA());
    expect(detail.id).toBe(id);
    expect(detail.family).toBe("TASK");
    expect(detail.status).toBe("In Progress");
    expect(detail.checklist).toHaveLength(1);
    expect(detail.checklist[0].label).toBe("Step 1");
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0].file_key).toBe("k1");
    expect(detail.transitions.map((t) => t.to_status)).toEqual(["In Progress"]);
    expect(detail.sla_state).toBeNull(); // no sla_clock_id on this fixture
    expect(detail.task_instance_id).toBeNull(); // this fixture isn't journey-created
  });

  it("getAction throws not_found for an unknown id", async () => {
    await expect(getAction("nope", crmA())).rejects.toThrow(/not found/);
  });
});

describe("actions/core: events coverage (rule 1 + Events section)", () => {
  it("action.created, action.status_changed, action.closed, action.cancelled, action.reassigned, action.evidence_verified all land in the event log", async () => {
    const types = ["action.created", "action.status_changed", "action.closed", "action.cancelled", "action.reassigned", "action.evidence_verified"];
    for (const t of types) {
      const r = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = $1 LIMIT 1`, [t]);
      expect(r.rows, `expected at least one ${t} event from the tests above`).toHaveLength(1);
    }
  });
});
