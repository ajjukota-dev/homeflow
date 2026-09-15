import { beforeAll, describe, expect, it } from "vitest";
import { initDb, db } from "./db";
import { runWithActor, runAsSystem, runFailClosed } from "./db/rls-context";
import { buildActor } from "./authz/buildActor";
import { ctxWithRoles } from "./authz/test-helpers";
import { getCustomerHome } from "./customer";
import { getBooking360 } from "./views/booking-360";
import { getUnit360 } from "./views/unit-360";
import { getCustomer360 } from "./views/customer-360";
import { returnBooking } from "./bookings-crm";
import { listDemands } from "./demands";
import { getCustomer } from "./model/customers";
import { AppError } from "./authz/types";
import type { Actor } from "./authz/types";
import { getChangeRequest } from "./change-requests/capture";
import { getAction, createAction } from "./actions/core";
import { listHolds } from "./sales/holds";
import { withTx } from "./events";

// Phase 4.1–4.3: GUCs + homeflow_app on the request path (not only rls.test.ts's
// manual SET ROLE), customer A ↛ B, East Crest ↛ Meadows, mask() on GET money/PII.

async function actorForEmail(email: string): Promise<Actor> {
  const r = await runAsSystem(() =>
    db.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])
  );
  const actor = await runAsSystem(() => buildActor(r.rows[0]!.id));
  if (!actor) throw new Error(`no actor for ${email}`);
  return actor;
}

describe("e41 — request-path RLS", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("e41-guc: runWithActor sets app.realm / project_ids and queries as homeflow_app", async () => {
    const actor = await actorForEmail("crm@demo.pranava");
    await runWithActor(actor, async () => {
      const r = await db.query<{ realm: string; user_id: string; all_projects: string; usr: string; project_ids: string }>(
        `SELECT current_setting('app.realm', true) AS realm,
                current_setting('app.user_id', true) AS user_id,
                current_setting('app.all_projects', true) AS all_projects,
                current_setting('app.project_ids', true) AS project_ids,
                current_user AS usr`
      );
      expect(r.rows[0]!.realm).toBe("staff");
      expect(r.rows[0]!.user_id).toBe(actor.user_id);
      expect(r.rows[0]!.all_projects).toBe("false");
      expect(r.rows[0]!.project_ids).toBe("p_eastcrest");
      expect(r.rows[0]!.usr).toBe("homeflow_app");
    });
  });

  it("e41-guc: ROLE does not leak after runWithActor (RESET ROLE in finally)", async () => {
    const actor = await actorForEmail("crm@demo.pranava");
    await runWithActor(actor, async () => {
      await db.query(`SELECT 1`);
    });
    const r = await runAsSystem(() => db.query<{ usr: string }>(`SELECT current_user AS usr`));
    expect(r.rows[0]!.usr).not.toBe("homeflow_app");
  });

  it("e41-customer: Ananya GET own home succeeds; Karthik booking 360 / home is not 200-with-body", async () => {
    const ananya = await actorForEmail("customer@demo.pranava");
    expect(ananya.kind).toBe("CUSTOMER");

    const own = await runWithActor(ananya, () => getCustomerHome("b_v112", { actor: ananya }));
    expect(own).not.toBeNull();
    expect(own?.unit_number).toBeTruthy();

    const otherHome = await runWithActor(ananya, () => getCustomerHome("b_v110", { actor: ananya }));
    expect(otherHome).toBeNull();

    const otherRows = await runWithActor(ananya, () =>
      db.query<{ id: string }>(`SELECT id FROM booking WHERE id = 'b_v110'`)
    );
    expect(otherRows.rows).toEqual([]);
  });

  it("e41-post0025: East Crest GUCs hide Meadows loan_case / commitment rows", async () => {
    const actor = await actorForEmail("crm@demo.pranava");
    await runWithActor(actor, async () => {
      const loans = await db.query<{ project_id: string }>(`SELECT project_id FROM loan_case`);
      for (const row of loans.rows) expect(row.project_id).toBe("p_eastcrest");
      const commitments = await db.query<{ project_id: string }>(`SELECT project_id FROM commitment`);
      for (const row of commitments.rows) expect(row.project_id).toBe("p_eastcrest");
    });
  });

  it("empty/missing realm fail-closed (explicit closed store, not test-default system)", async () => {
    await runFailClosed(async () => {
      const r = await db.query(`SELECT 1 FROM booking`);
      expect(r.rows.length).toBe(0);
    });
  });

  it("e4-seed: leftover occupants still exist; spare pool unbooked", async () => {
    const booked = await runAsSystem(() =>
      db.query<{ booking_number: string }>(
        `SELECT booking_number FROM booking
          WHERE booking_number IN ('BK-V110','BK-V111','BK-V112','BK-V113','BK-MT201','BK-V116')
          ORDER BY booking_number`
      )
    );
    expect(booked.rows.map((r) => r.booking_number)).toEqual([
      "BK-MT201",
      "BK-V110",
      "BK-V111",
      "BK-V112",
      "BK-V113",
      "BK-V116",
    ]);
    const spare = await runAsSystem(() =>
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM booking WHERE unit_id IN ('u_v101','u_v104','u_v108')`
      )
    );
    expect(spare.rows[0]!.n).toBe(0);
  });
});

describe("e42 — assertProjectScope on product handlers", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("e42-eastcrest-meadows: East Crest staff GET Meadows booking → 404; write → 403", async () => {
    const crm = await actorForEmail("crm@demo.pranava");
    expect(crm.project_ids).toEqual(["p_eastcrest"]);

    await runWithActor(crm, async () => {
      await expect(getBooking360("b_mt201", { actor: crm })).rejects.toMatchObject({ code: "not_found" });
      await expect(returnBooking("b_mv01", "out of scope", { actor: crm })).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });

  it("e42b: East Crest actor 404/403 on Meadows CR, action, holds", async () => {
    const crm = await actorForEmail("crm@demo.pranava");
    const cr = await runAsSystem(() =>
      db.query<{ id: string }>(`SELECT id FROM change_request WHERE booking_id = 'b_mt201' LIMIT 1`)
    );
    expect(cr.rows[0], "Nisha CR").toBeTruthy();
    await runWithActor(crm, async () => {
      await expect(getChangeRequest(cr.rows[0]!.id, { actor: crm })).rejects.toMatchObject({ code: "not_found" });
      await expect(listHolds("p_meadows", undefined, { actor: crm })).rejects.toMatchObject({ code: "not_found" });
    });
    const actionId = await runAsSystem(() =>
      withTx(undefined, (tx) =>
        createAction(
          {
            type: "exec_simple",
            title: "Meadows scoped",
            source_module: "e42b",
            source_entity_type: "test",
            source_entity_id: "e42b",
            project_id: "p_meadows",
            origin: "MANUAL",
            created_by: "user_superadmin",
          },
          tx
        )
      )
    );
    await runWithActor(crm, async () => {
      await expect(getAction(actionId, { actor: crm })).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("e42 reverse: Meadows-scoped actor GET East Crest booking → 404", async () => {
    const meadows = ctxWithRoles(["CRM"], ["p_meadows"]);
    await runWithActor(meadows.actor, async () => {
      await expect(getBooking360("b_v112", meadows)).rejects.toMatchObject({ code: "not_found" });
      await expect(getUnit360("u_v112", meadows)).rejects.toMatchObject({ code: "not_found" });
      await expect(getCustomer360("c_ananya", meadows)).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("MANAGEMENT still has project_ids ALL and can read both projects", async () => {
    const mgmt = await actorForEmail("management@demo.pranava");
    expect(mgmt.project_ids).toBe("ALL");
    await runWithActor(mgmt, async () => {
      const east = await getBooking360("b_v112", { actor: mgmt });
      expect(east.booking_id).toBe("b_v112");
      const meadows = await getBooking360("b_mt201", { actor: mgmt });
      expect(meadows.booking_id).toBe("b_mt201");
    });
  });
});

describe("e43 — mask() on GET responses", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("LEGAL (below READ_LIMITED on customer_financials) sees null amounts; ACCOUNTS sees numbers", async () => {
    const legal = ctxWithRoles(["LEGAL"], ["p_eastcrest"]);
    const accounts = ctxWithRoles(["ACCOUNTS"], ["p_eastcrest"]);

    const legalCust = await runWithActor(legal.actor, () => getCustomer("c_ananya", legal));
    expect(legalCust).not.toBeNull();
    expect(legalCust!.bookings.some((b) => b.total_consideration == null)).toBe(true);

    const acctCust = await runWithActor(accounts.actor, () => getCustomer("c_ananya", accounts));
    expect(acctCust).not.toBeNull();
    expect(acctCust!.bookings.some((b) => typeof b.total_consideration === "number" && b.total_consideration > 0)).toBe(
      true
    );
  });

  it("CRM (READ_STATUS_ONLY on collections) sees null demand amounts; ACCOUNTS sees numbers", async () => {
    const crm = ctxWithRoles(["CRM"], ["p_eastcrest"]);
    const accounts = ctxWithRoles(["ACCOUNTS"], ["p_eastcrest"]);

    const crmDemands = await runWithActor(crm.actor, () => listDemands("b_v112", db, crm));
    expect(crmDemands.length).toBeGreaterThan(0);
    expect(crmDemands.every((d) => d.amount == null)).toBe(true);

    const acctDemands = await runWithActor(accounts.actor, () => listDemands("b_v112", db, accounts));
    expect(acctDemands.some((d) => typeof d.amount === "number" && d.amount > 0)).toBe(true);
  });

  it("e43-ui-nulls: handler does not throw when amounts are null", async () => {
    const legal = ctxWithRoles(["LEGAL"], ["p_eastcrest"]);
    await expect(runWithActor(legal.actor, () => getCustomer("c_ananya", legal))).resolves.not.toBeNull();
  });
});

describe("e41 AppError mapping", () => {
  it("not_found stays an AppError so HTTP is 404 not 500", () => {
    const err = new AppError("not_found", "not found");
    expect(err.code).toBe("not_found");
  });
});
