import { beforeAll, describe, expect, it } from "vitest";
import { initDb, query } from "../db";
import { buildActor } from "./buildActor";

describe("buildActor", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("rule 9: a single-project staff user's default_project_id is set for the workspace to open in", async () => {
    const r = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'crm@demo.pranava'`);
    const actor = await buildActor(r.rows[0].id);
    expect(actor?.default_project_id).toBe("p_eastcrest");
    expect(actor?.project_ids).toEqual(["p_eastcrest"]);
  });

  it("MANAGEMENT gets project_ids 'ALL' (project switcher condition)", async () => {
    const r = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'management@demo.pranava'`);
    const actor = await buildActor(r.rows[0].id);
    expect(actor?.project_ids).toBe("ALL");
  });

  it("a DISABLED user does not build an actor (session should not validate)", async () => {
    const r = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'sales@demo.pranava'`);
    await query(`UPDATE "user" SET status = 'DISABLED' WHERE id = $1`, [r.rows[0].id]);
    expect(await buildActor(r.rows[0].id)).toBeNull();
    await query(`UPDATE "user" SET status = 'ACTIVE' WHERE id = $1`, [r.rows[0].id]); // restore for other tests
  });

  it("rule 10: google_sub exists and is unset — Google sign-in is not built yet, never auto-creates", async () => {
    const r = await query<{ google_sub: string | null }>(`SELECT google_sub FROM "user" WHERE email = 'management@demo.pranava'`);
    expect(r.rows[0].google_sub).toBeNull();
  });
});
