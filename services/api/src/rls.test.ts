import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";

// 0025_rls.sql (P1 of docs/reports/2026-09-05-branch-review.md's consolidation
// procedure). Proves the migration's policies actually isolate projects for a
// non-superuser connection — not literally every RLS-enabled table (that
// would just re-run the migration's own table list), but a representative
// sample spanning: a PK-is-project_id table (collection_policy), several
// NOT-NULL-project_id tables (unit/booking/demand/receipt/snag), the `project`
// table itself (scoped by `id`, not `project_id`), and two nullable-project_id
// "global row" tables (event, action). Also proves: all_projects bypass,
// fail-closed on an unset realm, and INSERT rejection into an out-of-scope
// project.
//
// GUCs are set by hand here (SET ROLE + set_config) because nothing threads
// ctx.actor into them yet — that's P1b (thread SET LOCAL into pg-adapter's
// transaction()), a separate PR. This file's superuser seed setup is
// unaffected by RLS (superusers bypass it by definition); only the
// SET ROLE homeflow_app block below is actually testing the policies.

const PROJECT_A = "p_eastcrest"; // seeded by initDb()'s demo data — real, rich fixture
const PROJECT_B = "p_rls_test2"; // hand-seeded, minimal, exists only to prove isolation

beforeAll(async () => {
  await initDb();

  await db.query(`INSERT INTO project (id, code, name) VALUES ($1,'RLST2','RLS Test Project 2')`, [PROJECT_B]);
  await db.query(
    `INSERT INTO project_hierarchy_node (id, project_id, kind, code, name) VALUES ('node_rlst2', $1, 'PHASE', 'P1', 'Phase 1')`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id)
     VALUES ('u_rlst2', $1, 'B-01', '3BHK', 'east', 'RLST2-B-01', 'node_rlst2')`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO booking (id, project_id, unit_id, booking_number, code)
     VALUES ('b_rlst2', $1, 'u_rlst2', 'BK-RLST2', 'BK-RLST2')`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, status)
     VALUES ('d_rlst2', 'b_rlst2', $1, 'booking_token', 'Booking amount', 1, 100000, 'due')`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO receipt (id, booking_id, project_id, demand_id, amount)
     VALUES ('r_rlst2', 'b_rlst2', $1, 'd_rlst2', 100000)`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO snag (id, unit_id, project_id, severity, location, trade, description)
     VALUES ('sn_rlst2', 'u_rlst2', $1, 'MINOR', 'kitchen', 'plumbing', 'test snag')`,
    [PROJECT_B]
  );
  await db.query(
    `INSERT INTO collection_policy (project_id, true_risk_max_probability) VALUES ($1, 0.5)`,
    [PROJECT_B]
  );

  const { rows: eventTypeRows } = await db.query<{ name: string }>(`SELECT name FROM event_type LIMIT 1`);
  const { rows: actionTypeRows } = await db.query<{ code: string }>(`SELECT code FROM action_type LIMIT 1`);
  await db.query(`INSERT INTO event (type, project_id, entity_type, entity_id) VALUES ($1, $2, 'project', $2)`, [
    eventTypeRows[0]!.name,
    PROJECT_B,
  ]);
  await db.query(`INSERT INTO event (type, project_id, entity_type, entity_id) VALUES ($1, NULL, 'project', 'global')`, [
    eventTypeRows[0]!.name,
  ]);
  await db.query(
    `INSERT INTO action (id, code, type, title, project_id, source_module, source_entity_type, source_entity_id, owner_role, origin)
     VALUES ('act_rlst2', 'ACT-RLST2', $1, 'test action', $2, 'test', 'project', $2, 'SALES', 'MANUAL')`,
    [actionTypeRows[0]!.code, PROJECT_B]
  );
});

async function asHomeflowApp<T>(realm: string, projectIds: string | null, allProjects: boolean, fn: () => Promise<T>): Promise<T> {
  await db.query(`SET ROLE homeflow_app`);
  try {
    await db.query(`SELECT set_config('app.realm', $1, false), set_config('app.project_ids', $2, false), set_config('app.all_projects', $3, false)`, [
      realm,
      projectIds ?? "",
      allProjects ? "true" : "false",
    ]);
    return await fn();
  } finally {
    await db.query(`RESET ROLE`);
  }
}

// Tables carrying a plain `project_id` column (Group A/B of the migration).
const PROJECT_ID_TABLES = ["unit", "booking", "demand", "receipt", "snag", "collection_policy"];

describe("0025_rls.sql — row-level security sweep", () => {
  it("a staff connection scoped to project A sees zero project-B rows on every sampled project_id table", async () => {
    await asHomeflowApp("staff", PROJECT_A, false, async () => {
      for (const table of PROJECT_ID_TABLES) {
        const r = await db.query<{ project_id: string }>(`SELECT project_id FROM ${table}`);
        expect(r.rows.length).toBeGreaterThan(0); // project A has real seeded rows in each
        for (const row of r.rows) {
          expect(row.project_id).toBe(PROJECT_A);
        }
      }
    });
  });

  it("the `project` table itself is scoped by id, not project_id", async () => {
    await asHomeflowApp("staff", PROJECT_A, false, async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM project`);
      expect(r.rows.map((row) => row.id)).toEqual([PROJECT_A]);
    });
  });

  it("nullable-project_id tables show project-A rows plus global (NULL) rows, never project B", async () => {
    await asHomeflowApp("staff", PROJECT_A, false, async () => {
      const events = await db.query<{ project_id: string | null }>(`SELECT project_id FROM event`);
      expect(events.rows.some((r) => r.project_id === null)).toBe(true);
      expect(events.rows.some((r) => r.project_id === PROJECT_B)).toBe(false);

      const actions = await db.query<{ project_id: string | null }>(`SELECT project_id FROM action`);
      expect(actions.rows.some((r) => r.project_id === PROJECT_B)).toBe(false);
    });
  });

  it("all_projects bypasses project scoping entirely", async () => {
    const superuserCount = (await db.query(`SELECT id FROM unit`)).rows.length;
    await asHomeflowApp("staff", null, true, async () => {
      const r = await db.query(`SELECT id FROM unit`);
      expect(r.rows.length).toBe(superuserCount);
    });
  });

  it("fails closed: an unset/empty app.realm returns zero rows even with project_ids set", async () => {
    await asHomeflowApp("", PROJECT_A, false, async () => {
      for (const table of PROJECT_ID_TABLES) {
        const r = await db.query(`SELECT 1 FROM ${table}`);
        expect(r.rows.length).toBe(0);
      }
    });
  });

  it("rejects an INSERT into a project outside the connection's scope", async () => {
    await expect(
      asHomeflowApp("staff", PROJECT_A, false, async () => {
        await db.query(
          `INSERT INTO snag (id, unit_id, project_id, severity, location, trade, description)
           VALUES ('sn_rejected', 'u_rlst2', $1, 'MINOR', 'kitchen', 'plumbing', 'should be rejected')`,
          [PROJECT_B]
        );
      })
    ).rejects.toThrow(/row-level security/);
  });

  it("allows an INSERT into the connection's own scoped project", async () => {
    await asHomeflowApp("staff", PROJECT_A, false, async () => {
      await db.query(
        `INSERT INTO snag (id, unit_id, project_id, severity, location, trade, description)
         VALUES ('sn_accepted', (SELECT id FROM unit WHERE project_id = $1 LIMIT 1), $1, 'MINOR', 'kitchen', 'plumbing', 'should succeed')`,
        [PROJECT_A]
      );
    });
    const r = await db.query(`SELECT id FROM snag WHERE id = 'sn_accepted'`);
    expect(r.rows.length).toBe(1);
  });
});
