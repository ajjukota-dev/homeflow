import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";
import { withTx, appendEvent } from "../events";
import { createAction } from "./core";
import { createProject, createUnit } from "../projects";
import { createSnag, assignSnag, startSnag, readySnag, verifySnag, closeSnagLifecycle } from "../qa/snags";
import { createWarrantyCase, triageWarrantyCase, assignWarrantyCase, startWarrantyCase, resolveWarrantyCase, closeWarrantyCase } from "../post-handover/warranty";
import { openPostHandoverCase } from "../post-handover/core";
import { createBooking, acceptBooking } from "../bookings";

// Spec 10 rule 7: when a source closes, auto-close its open actions with
// close_note = "Resolved by <event>". An event whose module does not exist
// creates nothing.

const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const qa = () => ctxAs("user_qa", ["QA"]);
const site = () => ctxAs("user_site", ["SITE"]);
const fm = () => ctxAs("user_fm", ["FM"]);

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "actsub", name: "Action Subscriber Test" }, superAdminCtx);
  PROJECT_ID = p.id;
  await db.query(`INSERT INTO contractor (id, name, trade) VALUES ('con_actsub', 'Action Sub Contractor', 'general') ON CONFLICT (id) DO NOTHING`);
});

async function freshUnit(): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `AS-${unitSeq}`, unit_type: "3BHK", facing: "East" }, superAdminCtx);
  return u!.id;
}

describe("actions/subscribers: spec 10 rule 7 auto-close", () => {
  it("closing a snag auto-closes its open action with close_note Resolved by snag.closed", async () => {
    const unitId = await freshUnit();
    const snag = await createSnag({ unit_id: unitId, room: "KITCHEN", category: "FLOORING", severity: "MINOR", description: "Grout gap for auto-close" }, qa());
    expect(snag.action_id).toBeTruthy();
    await assignSnag(snag.id, { assigned_to_user_id: "user_site" }, qa());
    await startSnag(snag.id, site());
    await readySnag(snag.id, { after_file_keys: ["k/after.jpg"] }, site());
    await verifySnag(snag.id, qa());
    await closeSnagLifecycle(snag.id, qa());

    const action = await db.query<{ status: string; close_note: string | null }>(
      `SELECT status, close_note FROM action WHERE id = $1`,
      [snag.action_id]
    );
    expect(action.rows[0]!.status).toBe("Closed");
    expect(action.rows[0]!.close_note).toBe("Resolved by snag.closed");
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE type = 'action.closed' AND entity_id = $1`, [snag.action_id]);
    expect(ev.rows.length).toBeGreaterThan(0);
  });

  it("auto-close is idempotent — a second source-close leaves the action Closed with the same note", async () => {
    const unitId = await freshUnit();
    const snag = await createSnag({ unit_id: unitId, room: "LIVING", category: "PAINTING", severity: "MINOR", description: "Paint drip for idempotent close" }, qa());
    await assignSnag(snag.id, { assigned_to_user_id: "user_site" }, qa());
    await startSnag(snag.id, site());
    await readySnag(snag.id, { after_file_keys: ["k/after2.jpg"] }, site());
    await verifySnag(snag.id, qa());
    await closeSnagLifecycle(snag.id, qa());
    await withTx(undefined, (tx) =>
      appendEvent(tx, {
        type: "snag.closed",
        entity_type: "snag",
        entity_id: snag.id,
        project_id: PROJECT_ID,
        unit_id: unitId,
        payload: { replay: true },
        actor_user_id: "user_qa",
        actor_kind: "USER",
      })
    );
    const action = await db.query<{ status: string; close_note: string | null; n: string }>(
      `SELECT a.status, a.close_note, (SELECT count(*)::text FROM event WHERE type = 'action.closed' AND entity_id = a.id) AS n
         FROM action a WHERE a.id = $1`,
      [snag.action_id]
    );
    expect(action.rows[0]!.status).toBe("Closed");
    expect(action.rows[0]!.close_note).toBe("Resolved by snag.closed");
    expect(Number(action.rows[0]!.n)).toBe(1);
  });

  it("closing a warranty case that never created an action creates no blank action", async () => {
    unitSeq += 1;
    const unitId = `u_as_w_${unitSeq}`;
    const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
    await db.query(
      `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
       VALUES ($1,'p_eastcrest',$2,'3BHK','EAST',$3,$4,'VILLA','available')`,
      [unitId, `ASW-${unitSeq}`, `U-ASW${unitSeq}`, node.rows[0]!.id]
    );
    const b = await createBooking(unitId, {
      applicant: { display_name: "Warranty AutoClose", phone: `98600${String(10000 + unitSeq)}`, pan: "WRAUT1234A" },
      total_consideration: 9800000,
      docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    await openPostHandoverCase(b.id, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: b.id, category: "ELECTRICAL", trade: "electrical", severity: "MINOR", description: "Socket loose" }, fm());
    const before = await db.query<{ count: string }>(`SELECT count(*)::text FROM action WHERE source_entity_type = 'warranty_case' AND source_entity_id = $1`, [created.id]);
    expect(Number(before.rows[0]!.count)).toBe(0);

    await triageWarrantyCase(created.id, fm());
    await assignWarrantyCase(created.id, "con_actsub", fm());
    await startWarrantyCase(created.id, ["before.jpg"], fm());
    await resolveWarrantyCase(created.id, { cost_inr: 0 }, fm());
    await closeWarrantyCase(created.id, fm());

    const after = await db.query<{ count: string }>(`SELECT count(*)::text FROM action WHERE source_entity_type = 'warranty_case' AND source_entity_id = $1`, [created.id]);
    expect(Number(after.rows[0]!.count)).toBe(0);
  });

  it("closing a warranty case auto-closes an existing open action for that case", async () => {
    unitSeq += 1;
    const unitId = `u_as_w2_${unitSeq}`;
    const node = await db.query<{ id: string }>(`SELECT id FROM project_hierarchy_node WHERE project_id = 'p_eastcrest' LIMIT 1`);
    await db.query(
      `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id, product_type, sale_status)
       VALUES ($1,'p_eastcrest',$2,'3BHK','EAST',$3,$4,'VILLA','available')`,
      [unitId, `ASW2-${unitSeq}`, `U-ASW2${unitSeq}`, node.rows[0]!.id]
    );
    const b = await createBooking(unitId, {
      applicant: { display_name: "Warranty With Action", phone: `98500${String(10000 + unitSeq)}`, pan: "WRACT1234A" },
      total_consideration: 9800000,
      docs: [{ type: "PAN card", received: true }, { type: "Address proof", received: true }, { type: "Photograph", received: true }],
    }, superAdminCtx);
    await acceptBooking(b.id, superAdminCtx);
    await openPostHandoverCase(b.id, unitId, "p_eastcrest");
    const created = await createWarrantyCase({ unit_id: unitId, booking_id: b.id, category: "PLUMBING", trade: "plumbing", severity: "MINOR", description: "Tap drip" }, fm());
    const actionId = await withTx(undefined, (tx) =>
      createAction(
        {
          type: "exec_simple",
          title: `FM: warranty ${created.id}`,
          project_id: "p_eastcrest",
          source_module: "warranty",
          source_entity_type: "warranty_case",
          source_entity_id: created.id,
          booking_id: b.id,
          unit_id: unitId,
          owner_role: "FM",
          origin: "AUTO",
        },
        tx
      )
    );
    await triageWarrantyCase(created.id, fm());
    await assignWarrantyCase(created.id, "con_actsub", fm());
    await startWarrantyCase(created.id, [], fm());
    await resolveWarrantyCase(created.id, {}, fm());
    await closeWarrantyCase(created.id, fm());

    const action = await db.query<{ status: string; close_note: string | null }>(`SELECT status, close_note FROM action WHERE id = $1`, [actionId]);
    expect(action.rows[0]!.status).toBe("Closed");
    expect(action.rows[0]!.close_note).toBe("Resolved by warranty.case_closed");
  });

  it("payment.received auto-closes open demand actions with Resolved by payment.received", async () => {
    const demandId = `d_actsub_${unitSeq + 1}`;
    const actionId = await withTx(undefined, (tx) =>
      createAction(
        {
          type: "exec_simple",
          title: "Follow up — booking token",
          project_id: PROJECT_ID,
          source_module: "collections",
          source_entity_type: "demand",
          source_entity_id: demandId,
          owner_role: "ACCOUNTS",
          origin: "AUTO",
        },
        tx
      )
    );
    await withTx(undefined, (tx) =>
      appendEvent(tx, {
        type: "payment.received",
        entity_type: "receipt",
        entity_id: `rcpt_actsub_${demandId}`,
        project_id: PROJECT_ID,
        payload: { demand_id: demandId, amount: 1000 },
        actor_user_id: "user_superadmin",
        actor_kind: "USER",
      })
    );
    const action = await db.query<{ status: string; close_note: string | null }>(`SELECT status, close_note FROM action WHERE id = $1`, [actionId]);
    expect(action.rows[0]!.status).toBe("Closed");
    expect(action.rows[0]!.close_note).toBe("Resolved by payment.received");
  });

  it("an event type whose module does not exist creates no action", async () => {
    const before = await db.query<{ count: string }>(`SELECT count(*)::text FROM action`);
    await withTx(undefined, (tx) =>
      appendEvent(tx, {
        type: "demand.status_changed",
        entity_type: "demand",
        entity_id: "d_does_not_exist_module",
        payload: {},
        actor_user_id: null,
        actor_kind: "SYSTEM",
      })
    );
    const after = await db.query<{ count: string }>(`SELECT count(*)::text FROM action`);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    const blank = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM action WHERE source_entity_id = 'd_does_not_exist_module'`
    );
    expect(Number(blank.rows[0]!.count)).toBe(0);
  });
});
