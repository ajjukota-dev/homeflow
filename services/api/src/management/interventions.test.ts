import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { controlTower, actIntervention, dismissIntervention } from "./interventions";
import { superAdminCtx as fakeSuperAdminCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";

beforeAll(async () => {
  await initDb();
});

// `ctx.actor.user_id` must be a real seeded row — actIntervention now FKs it via
// `action.created_by` (createAction) and `intervention.acted_by`, same convention
// commitments/core.test.ts and handover.test.ts already established.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };

describe("actIntervention (27 rule 1/3 — Act records the real actor, the acceptance's own named regression for PR #8's null)", () => {
  it("sets status acted, stamps acted_at with the real actor, and links a real action", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const id = tower.interventions[0].id;
    const acted = await actIntervention(id, superAdminCtx);
    expect(acted.status).toBe("acted");
    expect(acted.acted_at).not.toBeNull();
    expect(acted.acted_by).toBe("user_superadmin");
    expect(acted.action_id).toBeTruthy();
    const action = await db.query<{ id: string }>(`SELECT id FROM action WHERE id = $1`, [acted.action_id]);
    expect(action.rows[0]).toBeTruthy();
  });

  it("is idempotent: a second Act returns the same acted_at and writes nothing new", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const id = tower.interventions[1].id;
    const first = await actIntervention(id, superAdminCtx);
    expect(first.acted_at).toBeTruthy();
    const before = await db.query<{ count: string }>(`SELECT count(*) FROM intervention WHERE status = 'acted'`);
    const second = await actIntervention(id, superAdminCtx);
    const after = await db.query<{ count: string }>(`SELECT count(*) FROM intervention WHERE status = 'acted'`);
    expect(second.acted_at).toEqual(first.acted_at);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("throws not_found for an unknown intervention id", async () => {
    await expect(actIntervention("does-not-exist", superAdminCtx)).rejects.toThrow("not_found");
  });

  it("carries acted_at into the tower response so the UI can show when", async () => {
    const before = await controlTower("p_eastcrest", superAdminCtx);
    const id = before.interventions[2].id;
    await actIntervention(id, superAdminCtx);
    const row = (await controlTower("p_eastcrest", superAdminCtx)).interventions.find((i) => i.id === id)!;
    expect(row.status).toBe("acted");
    expect(row.acted_at).toBeTruthy();
  });
});

describe("dismissIntervention (27 rule 2 — dismiss requires a reason; cooldown against source_refs)", () => {
  it("requires a non-empty reason", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const open = tower.interventions.find((i) => i.status === "open")!;
    await expect(dismissIntervention(open.id, "", superAdminCtx)).rejects.toThrow("reason");
  });

  it("marks the intervention dismissed with the given reason", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const open = tower.interventions.find((i) => i.status === "open")!;
    const dismissed = await dismissIntervention(open.id, "already resolved offline", superAdminCtx);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismiss_reason).toBe("already resolved offline");
    expect(dismissed.dismissed_at).not.toBeNull();
    const evt = await db.query(`SELECT 1 FROM event WHERE type = 'intervention.dismissed' AND entity_id = $1`, [open.id]);
    expect(evt.rows.length).toBe(1);
  });

  it("cannot dismiss an already-acted intervention", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const acted = tower.interventions.find((i) => i.status === "acted")!;
    await expect(dismissIntervention(acted.id, "reason", superAdminCtx)).rejects.toThrow(/cannot dismiss/);
  });

  it("does not carry a stale dismissal onto a genuinely different candidate in the same slot", async () => {
    // A prior dismissal recorded against source_refs the current seed data no longer produces
    // (the underlying issue was resolved/changed) must not silently suppress today's real
    // candidate for that category — that was the bug: the id is keyed by (project, category), so
    // recompute used to carry the OLD row's status forward regardless of whether the candidate
    // underneath it had changed.
    const id = "tw_p_eastcrest_reputation";
    await db.query(
      `UPDATE intervention SET status = 'dismissed', dismissed_at = now(), dismiss_reason = 'stale', source_refs = '{"snag:fake_stale_123"}' WHERE id = $1`,
      [id]
    );
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    const reputation = tower.interventions.find((i) => i.category === "reputation")!;
    expect(reputation.status).not.toBe("dismissed");
    expect(reputation.source_refs).not.toContain("snag:fake_stale_123");
  });
});

describe("controlTower (27 rule 1 — five, exactly one per category)", () => {
  it("always returns exactly 5 interventions, one per the 5 named categories", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    expect(tower.interventions.length).toBe(5);
    expect(new Set(tower.interventions.map((i) => i.category)).size).toBe(5);
  });

  it("every intervention carries impact {inr, customers, days} (rule 1's Data shape)", async () => {
    const tower = await controlTower("p_eastcrest", superAdminCtx);
    for (const i of tower.interventions) {
      expect(i.decision_pack.impact).toHaveProperty("inr");
      expect(i.decision_pack.impact).toHaveProperty("customers");
      expect(i.decision_pack.impact).toHaveProperty("days");
    }
  });

  it("records intervention.computed only when a recompute actually changes something, not on every read", async () => {
    // Compute-on-read (rule 1) must not append to the immutable event log on every GET — only
    // when the recomputed decision pack genuinely differs from what's stored.
    await controlTower("p_eastcrest", superAdminCtx);
    const steadyBefore = await db.query<{ count: string }>(`SELECT count(*) FROM event WHERE type = 'intervention.computed'`);
    await controlTower("p_eastcrest", superAdminCtx);
    const steadyAfter = await db.query<{ count: string }>(`SELECT count(*) FROM event WHERE type = 'intervention.computed'`);
    expect(steadyAfter.rows[0].count).toBe(steadyBefore.rows[0].count);

    await db.query(`UPDATE intervention SET headline = 'stale test headline' WHERE id = 'tw_p_eastcrest_cash'`);
    const changedBefore = await db.query<{ count: string }>(`SELECT count(*) FROM event WHERE type = 'intervention.computed'`);
    await controlTower("p_eastcrest", superAdminCtx);
    const changedAfter = await db.query<{ count: string }>(`SELECT count(*) FROM event WHERE type = 'intervention.computed'`);
    expect(Number(changedAfter.rows[0].count)).toBeGreaterThan(Number(changedBefore.rows[0].count));
  });
});
