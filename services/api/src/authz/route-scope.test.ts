import { beforeAll, describe, expect, it } from "vitest";
import { initDb, db } from "../db";
import { runAsSystem } from "../db/rls-context";
import { buildActor } from "./buildActor";
import { AppError, type Actor } from "./types";
import { assertRequestProjectScope } from "./route-scope";
import { listProjects } from "../projects";
import { listBookings } from "../bookings";
import { listUnits } from "../handlers";
import { listTemplates } from "../journey/templates";
import { listRules } from "../changeability/core";
import { listAssignments } from "../auth/adminAssignments";

async function actorForEmail(email: string): Promise<Actor> {
  const r = await runAsSystem(() => db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]));
  const actor = await runAsSystem(() => buildActor(r.rows[0]!.id));
  if (!actor) throw new Error(`no actor for ${email}`);
  return actor;
}

describe("project scope on project-data routes", () => {
  let east: Actor;
  let management: Actor;
  let superAdmin: Actor;
  let meadowsUnit: string;

  beforeAll(async () => {
    await initDb();
    east = await actorForEmail("crm@demo.pranava");
    management = await actorForEmail("management@demo.pranava");
    superAdmin = await actorForEmail("superadmin@demo.pranava");
    const unit = await runAsSystem(() =>
      db.query<{ unit_id: string }>(`SELECT unit_id FROM booking WHERE id = 'b_mt201'`)
    );
    meadowsUnit = unit.rows[0]!.unit_id;
  });

  it("an East Crest user is blocked on a guessed Meadows read and write; Management and Super Admin are not", async () => {
    expect(east.project_ids).toEqual(["p_eastcrest"]);
    expect(management.project_ids).toBe("ALL");
    expect(superAdmin.project_ids).toBe("ALL");

    await expect(assertRequestProjectScope(east, "GET", "/api/bookings/b_mt201/scores/booking-readiness")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(assertRequestProjectScope(east, "GET", `/api/units/${meadowsUnit}/passport`)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(assertRequestProjectScope(east, "GET", "/api/projects/p_meadows/master")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(assertRequestProjectScope(east, "PATCH", "/api/projects/p_meadows", {}, { name: "Renamed" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(assertRequestProjectScope(east, "PUT", `/api/units/${meadowsUnit}/passport`)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      assertRequestProjectScope(east, "POST", "/api/service-records", {}, { unit_id: meadowsUnit })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      assertRequestProjectScope(east, "GET", "/api/warranty-cases", { project_id: "p_meadows" })
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(assertRequestProjectScope(east, "GET", "/api/projects/p_eastcrest/master")).resolves.toBeUndefined();
    await expect(assertRequestProjectScope(east, "GET", "/api/bookings/does-not-exist")).resolves.toBeUndefined();

    await expect(assertRequestProjectScope(management, "GET", "/api/bookings/b_mt201")).resolves.toBeUndefined();
    await expect(assertRequestProjectScope(management, "GET", "/api/projects/p_eastcrest/master")).resolves.toBeUndefined();
    await expect(assertRequestProjectScope(superAdmin, "PATCH", "/api/projects/p_meadows")).resolves.toBeUndefined();
    await expect(assertRequestProjectScope(superAdmin, "GET", `/api/units/${meadowsUnit}`)).resolves.toBeUndefined();
  });

  it("a scope miss is an AppError, not a raw exception", async () => {
    await expect(assertRequestProjectScope(east, "GET", "/api/teams/p_meadows/day")).rejects.toBeInstanceOf(AppError);
  });

  it("lists projects, bookings, and units through the route handlers, and an East Crest user does not receive Meadows", async () => {
    const eastProjects = await listProjects({ actor: east });
    const eastBookings = await listBookings(undefined, { actor: east });
    const eastUnits = await listUnits(undefined, { actor: east });
    const eastUnit = await runAsSystem(() =>
      db.query<{ id: string }>(`SELECT id FROM unit WHERE project_id = 'p_eastcrest' ORDER BY unit_number LIMIT 1`)
    );
    const eastBooking = await runAsSystem(() =>
      db.query<{ id: string }>(`SELECT id FROM booking WHERE project_id = 'p_eastcrest' ORDER BY created_at LIMIT 1`)
    );

    expect(eastProjects.map((p) => p.id)).toContain("p_eastcrest");
    expect(eastProjects.map((p) => p.id)).not.toContain("p_meadows");
    expect(eastBookings.map((b) => b.id)).toContain(eastBooking.rows[0]!.id);
    expect(eastBookings.map((b) => b.id)).not.toContain("b_mt201");
    expect(eastUnits.map((u) => u.id)).toContain(eastUnit.rows[0]!.id);
    expect(eastUnits.map((u) => u.id)).not.toContain(meadowsUnit);

    for (const actor of [management, superAdmin]) {
      const projects = await listProjects({ actor });
      const bookings = await listBookings(undefined, { actor });
      const units = await listUnits(undefined, { actor });
      expect(projects.map((p) => p.id)).toEqual(expect.arrayContaining(["p_eastcrest", "p_meadows"]));
      expect(bookings.map((b) => b.id)).toContain("b_mt201");
      expect(units.map((u) => u.id)).toContain(meadowsUnit);
    }

    await expect(assertRequestProjectScope(east, "GET", "/api/bookings/b_mt201")).rejects.toMatchObject({ code: "not_found" });
    await expect(assertRequestProjectScope(east, "PATCH", "/api/projects/p_meadows")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("journey templates, change-gate rules, and assignments omit Meadows when the request has no id", async () => {
    await runAsSystem(async () => {
      await db.query(
        `INSERT INTO journey_template (id, code, name, scope, project_id)
         VALUES ('jt_meadows_scope', 'MEADOWS_SCOPE_PROBE', 'Meadows scope probe', 'PROJECT', 'p_meadows')
         ON CONFLICT (id) DO NOTHING`
      );
      const rule = await db.query(`SELECT id FROM change_gate_rule WHERE code = 'meadows_scope_probe'`);
      if (rule.rows.length === 0) {
        await db.query(
          `INSERT INTO change_gate_rule (code, category_code, project_id, trigger_component_code, min_state, resulting_state)
           VALUES ('meadows_scope_probe', 'structural', 'p_meadows', 'structure', 'complete', 'HARD_CLOSED')`
        );
      }
      await db.query(
        `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, effective_from)
         VALUES ('pta_meadows_scope', 'p_meadows', $1, 'CRM', 'CRM', '2020-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [management.user_id]
      );
    });

    // Journey templates and assignments are role-gated to Management. Keep East Crest's
    // project list and add that role so the handler reaches the project filter.
    const eastDesk: Actor = { ...east, roles: ["CRM", "MANAGEMENT"] };

    const templates = await listTemplates({ actor: eastDesk });
    expect(templates.map((row) => row.project_id)).not.toContain("p_meadows");
    expect(templates.some((row) => row.project_id === null || row.project_id === "p_eastcrest")).toBe(true);

    const rules = await listRules({}, { actor: east });
    expect(rules.map((row) => row.project_id)).not.toContain("p_meadows");
    expect(rules.some((row) => row.project_id === null)).toBe(true);

    const assignments = await listAssignments({ actor: eastDesk });
    expect(assignments.map((row) => row.project_id)).not.toContain("p_meadows");
    expect(assignments.map((row) => row.project_id)).toContain("p_eastcrest");

    for (const actor of [management, superAdmin]) {
      expect((await listTemplates({ actor })).map((row) => row.project_id)).toContain("p_meadows");
      expect((await listRules({}, { actor })).map((row) => row.project_id)).toContain("p_meadows");
      expect((await listAssignments({ actor })).map((row) => row.project_id)).toContain("p_meadows");
    }
  });
});
