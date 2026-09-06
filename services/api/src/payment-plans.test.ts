import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { listPaymentPlans, getPaymentPlan, createPaymentPlan, updatePaymentPlan } from "./payment-plans";
import { ctxWithRoles } from "./authz/test-helpers";

// 19-collections-true-risk.md Screens: "Studio: Payment plans" — plan_eastcrest (seed.ts) is
// the real seeded plan this exercises: 5 milestones summing to 100% of consideration.

const accountsCtx = ctxWithRoles(["ACCOUNTS"]);
const superAdminCtx = ctxWithRoles(["SUPER_ADMIN"]);
const salesCtx = ctxWithRoles(["SALES"]);

beforeAll(async () => {
  await initDb();
});

describe("listPaymentPlans / getPaymentPlan", () => {
  it("lists the real seeded plans with their milestones ordered by sequence", async () => {
    const plans = await listPaymentPlans(salesCtx); // any staff role can read
    const eastcrest = plans.find((p) => p.id === "plan_eastcrest");
    expect(eastcrest).toBeTruthy();
    expect(eastcrest!.milestones.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(eastcrest!.milestones[0].milestone_key).toBe("booking_token");
  });

  it("getPaymentPlan 404s for an unknown id", async () => {
    await expect(getPaymentPlan("plan_nope", accountsCtx)).rejects.toThrow(/not found/);
  });
});

describe("createPaymentPlan", () => {
  it("refuses SALES; ACCOUNTS and SUPER_ADMIN can create", async () => {
    const input = {
      project_id: null,
      name: "Test plan",
      basis: "construction_linked",
      milestones: [{ milestone_key: "m1", milestone_label: "First", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }],
    };
    await expect(createPaymentPlan(input, salesCtx)).rejects.toThrow(/requires one of/);
    const created = await createPaymentPlan(input, accountsCtx);
    expect(created.name).toBe("Test plan");
    expect(created.milestones).toHaveLength(1);

    const created2 = await createPaymentPlan({ ...input, name: "Test plan 2" }, superAdminCtx);
    expect(created2.id).not.toBe(created.id);
  });

  it("rejects an empty milestone list, a duplicate milestone_key, and a duplicate sequence", async () => {
    const base = { project_id: null, name: "Bad plan", basis: "construction_linked" };
    await expect(createPaymentPlan({ ...base, milestones: [] }, accountsCtx)).rejects.toThrow(/at least one milestone/);
    await expect(
      createPaymentPlan(
        {
          ...base,
          milestones: [
            { milestone_key: "m1", milestone_label: "A", construction_trigger_event: null, sequence: 1, pct_of_consideration: 50 },
            { milestone_key: "m1", milestone_label: "B", construction_trigger_event: null, sequence: 2, pct_of_consideration: 50 },
          ],
        },
        accountsCtx
      )
    ).rejects.toThrow(/duplicate milestone_key/);
    await expect(
      createPaymentPlan(
        {
          ...base,
          milestones: [
            { milestone_key: "m1", milestone_label: "A", construction_trigger_event: null, sequence: 1, pct_of_consideration: 50 },
            { milestone_key: "m2", milestone_label: "B", construction_trigger_event: null, sequence: 1, pct_of_consideration: 50 },
          ],
        },
        accountsCtx
      )
    ).rejects.toThrow(/duplicate sequence/);
  });
});

describe("updatePaymentPlan", () => {
  it("replaces the milestone list wholesale without disturbing demands already generated from the old list", async () => {
    const created = await createPaymentPlan(
      {
        project_id: null,
        name: "Editable plan",
        basis: "construction_linked",
        milestones: [{ milestone_key: "m1", milestone_label: "First", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }],
      },
      accountsCtx
    );

    const updated = await updatePaymentPlan(
      created.id,
      {
        project_id: null,
        name: "Renamed plan",
        basis: "construction_linked",
        milestones: [
          { milestone_key: "m1", milestone_label: "First (renamed)", construction_trigger_event: null, sequence: 1, pct_of_consideration: 40 },
          { milestone_key: "m2", milestone_label: "Second", construction_trigger_event: "structure:complete", sequence: 2, pct_of_consideration: 60 },
        ],
      },
      accountsCtx
    );

    expect(updated.name).toBe("Renamed plan");
    expect(updated.milestones).toHaveLength(2);
    expect(updated.milestones.map((m) => m.milestone_key)).toEqual(["m1", "m2"]);

    // plan_eastcrest's own real seeded milestones are untouched by any of this test's writes —
    // demand rows generated against them (demands-schedule.ts copies values at generation time,
    // no live FK to payment_plan_milestone.id) would be unaffected by an update like this one.
    const eastcrestMilestones = await db.query(`SELECT id FROM payment_plan_milestone WHERE plan_id = 'plan_eastcrest'`);
    expect(eastcrestMilestones.rows).toHaveLength(5);
  });

  it("404s updating an unknown plan; refuses SALES", async () => {
    const patch = { project_id: null, name: "x", basis: "y", milestones: [{ milestone_key: "m1", milestone_label: "A", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }] };
    await expect(updatePaymentPlan("plan_nope", patch, accountsCtx)).rejects.toThrow(/not found/);
    await expect(updatePaymentPlan("plan_eastcrest", patch, salesCtx)).rejects.toThrow(/requires one of/);
  });

  it("can attach a plan created with no project to a real project (fixes: a plan left at project_id null is unreachable by demands-schedule.ts's per-project lookup)", async () => {
    const created = await createPaymentPlan(
      {
        project_id: null,
        name: "Unassigned plan",
        basis: "construction_linked",
        milestones: [{ milestone_key: "m1", milestone_label: "First", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }],
      },
      accountsCtx
    );
    expect(created.project_id).toBeNull();

    const updated = await updatePaymentPlan(
      created.id,
      {
        project_id: "p_eastcrest",
        name: created.name,
        basis: created.basis,
        milestones: [{ milestone_key: "m1", milestone_label: "First", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }],
      },
      accountsCtx
    );
    expect(updated.project_id).toBe("p_eastcrest");
  });
});

describe("validateMilestones (via createPaymentPlan)", () => {
  it("treats an untrimmed duplicate key as a duplicate, not two distinct milestones", async () => {
    await expect(
      createPaymentPlan(
        {
          project_id: null,
          name: "Whitespace key plan",
          basis: "construction_linked",
          milestones: [
            { milestone_key: "m1", milestone_label: "A", construction_trigger_event: null, sequence: 1, pct_of_consideration: 50 },
            { milestone_key: " m1", milestone_label: "B", construction_trigger_event: null, sequence: 2, pct_of_consideration: 50 },
          ],
        },
        accountsCtx
      )
    ).rejects.toThrow(/duplicate milestone_key/);
  });
});
