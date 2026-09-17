import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "./authz/test-helpers";
import { createProject, createUnit } from "./projects";
import { createProspect } from "./sales/prospects";
import { bookFromInventory, confirmInventoryBooking } from "./sales/booking";
import { submitHandover, acceptHandover } from "./sales-handover/core";
import { completeHandover } from "./qa";
import { completeRegistration } from "./legal-docs";
import { loadOrCreateCase as loadOrCreateHandover } from "./handover/store";
import { loadOrCreateCase as loadOrCreateRegistration } from "./registration/store";
import type { Ctx } from "./authz/types";

// Phase 6 — canonical booking shape. Failing tests first for 6.1 / 6.2 / 6.3 / 6.6 / 6.8.

const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const sales = () => ctxAs("user_sales", ["SALES"]);
const crm = () => ctxAs("user_crm", ["CRM"]);

const SRC = fileURLToPath(new URL("./", import.meta.url));
const SEED_DIR = join(SRC, "seed");

const FULL_DOCS = [
  { type: "PAN card", received: true },
  { type: "Address proof", received: true },
  { type: "Photograph", received: true },
];
const FULL_CONFIRMATIONS = {
  applicant_details_confirmed: true,
  contact_verified: true,
  nri_status_confirmed: true,
  communication_pref_confirmed: true,
  unit_confirmed: true,
  facing_confirmed: true,
  parking_confirmed: true,
};

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...walkTs(p));
    else if (name.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("6.1 one write path", () => {
  it("seed files do not call createBooking(", () => {
    for (const file of walkTs(SEED_DIR)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/createBooking\s*\(/);
    }
  });

  it("after initDb Karthik primary applicant is c_karthik; Aditi already has a customer; spare pool unbooked", async () => {
    await initDb();
    const karthik = await db.query<{ customer_id: string | null; residency: string; status: string }>(
      `SELECT ba.customer_id, c.residency, b.status
         FROM booking b
         JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
         JOIN customer c ON c.id = ba.customer_id
        WHERE b.id = 'b_v110'`
    );
    expect(karthik.rows[0]?.customer_id).toBe("c_karthik");
    expect(karthik.rows[0]?.status).toBe("active");

    const aditi = await db.query<{ customer_id: string | null }>(
      `SELECT customer_id FROM booking_applicant WHERE booking_id = 'b_mv01' AND role = 'primary'`
    );
    expect(aditi.rows[0]?.customer_id).toBeTruthy();
    expect(aditi.rows[0]?.customer_id).toBe("c_aditi");

    const spare = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking WHERE unit_id IN ('u_v101','u_v104','u_v108')`
    );
    expect(spare.rows[0]!.n).toBe(0);
  }, 180_000);
});

describe("6.2 packet residency lands on customer", () => {
  let projectId: string;
  let unitSeq = 0;

  beforeAll(async () => {
    await initDb();
    const p = await createProject({ code: "p6res", name: "Phase 6 Residency" }, superAdminCtx);
    projectId = p.id;
    await db.query(
      `INSERT INTO project_team_assignment (id, project_id, user_id, department, role_scope, assignment_type, is_primary_owner, effective_from)
       VALUES ('pta_p6res_crm', $1, 'user_crm', 'CRM', 'CRM', 'DEDICATED', true, '2020-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [projectId]
    );
  }, 180_000);

  it("packet NRI → accept → customer.residency is NRI (no post-accept patch)", async () => {
    unitSeq += 1;
    const unit = await createUnit(projectId, { unit_number: `P6R-${unitSeq}`, unit_type: "2BHK", facing: "East", base_price_inr: 6_000_000 }, superAdminCtx);
    const prospect = await createProspect({ project_id: projectId, name: "Nri Packet Buyer" }, sales());
    const booked = await bookFromInventory(
      prospect.id,
      {
        unit_id: unit!.id,
        applicants: [{ display_name: "Nri Packet Buyer", phone: "9845099001", pan: "NRIPK1234A", residency: "RESIDENT" }],
        price_inr: 6_000_000,
        docs: FULL_DOCS,
      },
      sales()
    );
    await confirmInventoryBooking(booked.booking_id, sales());
    await submitHandover(
      booked.booking_id,
      { confirmations: FULL_CONFIRMATIONS, commercial: { payment_plan_ref: "PP-1" }, residency: "NRI" },
      sales()
    );
    await acceptHandover(booked.booking_id, crm());
    const row = await db.query<{ residency: string }>(
      `SELECT c.residency FROM booking_applicant ba JOIN customer c ON c.id = ba.customer_id
        WHERE ba.booking_id = $1 AND ba.role = 'primary'`,
      [booked.booking_id]
    );
    expect(row.rows[0]!.residency).toBe("NRI");
  });

  it("Leela is NRI from the book write, not only a leftover patch", async () => {
    const leela = await db.query<{ residency: string }>(`SELECT residency FROM customer WHERE id = 'c_leela'`);
    expect(leela.rows[0]?.residency).toBe("NRI");
  });
});

describe("6.3 agreement_value_inr is the money", () => {
  it("domain handlers do not SELECT total_consideration as source of truth", () => {
    const skip = /\.test\.ts$/;
    const hits: string[] = [];
    for (const file of walkTs(SRC)) {
      if (skip.test(file) || file.includes("/seed/")) continue;
      const src = readFileSync(file, "utf8");
      const sqlSelects = src.match(/SELECT[\s\S]{0,500}?FROM/gi) ?? [];
      for (const sel of sqlSelects) {
        if (!/\btotal_consideration\b/.test(sel)) continue;
        if (/total_consideration\s*=\s*agreement_value_inr/.test(sel)) continue;
        if (/agreement_value_inr[\s\S]{0,80}AS total_consideration/.test(sel)) continue;
        hits.push(`${file}: ${sel.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("Karthik demands sum to agreement_value_inr 1.2 Cr", async () => {
    await initDb();
    const row = await db.query<{ agreement_value_inr: number; total_consideration: number; demand_sum: number }>(
      `SELECT agreement_value_inr::float8 AS agreement_value_inr,
              total_consideration::float8 AS total_consideration,
              (SELECT SUM(amount)::float8 FROM demand WHERE booking_id = 'b_v110') AS demand_sum
         FROM booking WHERE id = 'b_v110'`
    );
    expect(row.rows[0]!.agreement_value_inr).toBe(12_000_000);
    expect(row.rows[0]!.demand_sum).toBe(12_000_000);
    expect(row.rows[0]!.total_consideration).toBe(row.rows[0]!.agreement_value_inr);
  }, 180_000);
});

describe("6.4 / 6.5 / 6.7", () => {
  beforeAll(async () => {
    await initDb();
  }, 180_000);

  it("6.4 Karthik rm_owner_user_id is a CRM user; no SET rm_owner in handlers", async () => {
    const srcHits: string[] = [];
    for (const file of walkTs(SRC)) {
      if (/\.test\.ts$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      if (/SET\s+rm_owner\s*=/.test(src) || /rm_owner\s*=\s*\$/.test(src)) srcHits.push(file);
    }
    expect(srcHits, srcHits.join("\n")).toEqual([]);
    const row = await db.query<{ rm_owner_user_id: string | null }>(
      `SELECT rm_owner_user_id FROM booking WHERE id = 'b_v110'`
    );
    expect(row.rows[0]!.rm_owner_user_id).toBeTruthy();
    const crm = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM project_team_assignment
        WHERE user_id = $1 AND department = 'CRM'`,
      [row.rows[0]!.rm_owner_user_id]
    );
    expect(crm.rows[0]!.n).toBeGreaterThan(0);
  });

  it("6.5 occupant code === booking_number === click-path id", async () => {
    const row = await db.query<{ code: string; booking_number: string }>(
      `SELECT code, booking_number FROM booking WHERE id = 'b_v110'`
    );
    expect(row.rows[0]!.code).toBe("BK-V110");
    expect(row.rows[0]!.booking_number).toBe("BK-V110");
  });

  it("6.5 new book mints the same string on code and booking_number", async () => {
    const p = await createProject({ code: "p6code", name: "Phase 6 Codes" }, superAdminCtx);
    const unit = await createUnit(p.id, { unit_number: "P6C-1", unit_type: "2BHK", facing: "East", base_price_inr: 5_000_000 }, superAdminCtx);
    const prospect = await createProspect({ project_id: p.id, name: "Code Buyer" }, sales());
    const booked = await bookFromInventory(
      prospect.id,
      { unit_id: unit!.id, applicants: [{ display_name: "Code Buyer", residency: "RESIDENT" }], price_inr: 5_000_000 },
      sales()
    );
    const row = await db.query<{ code: string; booking_number: string }>(
      `SELECT code, booking_number FROM booking WHERE id = $1`,
      [booked.booking_id]
    );
    expect(row.rows[0]!.code).toBe(booked.code);
    expect(row.rows[0]!.booking_number).toBe(booked.code);
  });

  it("6.7 CO_APPLICANT persists with a customer row", async () => {
    const p = await createProject({ code: "p6role", name: "Phase 6 Roles" }, superAdminCtx);
    const unit = await createUnit(p.id, { unit_number: "P6L-1", unit_type: "2BHK", facing: "East", base_price_inr: 5_000_000 }, superAdminCtx);
    const prospect = await createProspect({ project_id: p.id, name: "Joint Buyers" }, sales());
    const booked = await bookFromInventory(
      prospect.id,
      {
        unit_id: unit!.id,
        applicants: [
          { display_name: "Primary Buyer", residency: "RESIDENT", role: "PRIMARY" },
          { display_name: "Co Buyer", residency: "RESIDENT", role: "CO_APPLICANT" },
        ],
        price_inr: 5_000_000,
      },
      sales()
    );
    const rows = await db.query<{ role: string; customer_id: string | null }>(
      `SELECT role, customer_id FROM booking_applicant WHERE booking_id = $1 ORDER BY sort_order`,
      [booked.booking_id]
    );
    expect(rows.rows.map((r) => r.role)).toEqual(["primary", "CO_APPLICANT"]);
    expect(rows.rows[1]!.customer_id).toBeTruthy();
  });
});

describe("6.6 forecast follows plan revision", () => {
  beforeAll(async () => {
    await initDb();
  }, 180_000);

  it("BK-V110 and BK-MT201 have forecast_end = planned_end ≠ baseline_end and a forecast revision row", async () => {
    for (const bookingId of ["b_v110", "b_mt201"]) {
      const stages = await db.query<{ planned_end: string | Date; baseline_end: string | Date; forecast_end: string | Date }>(
        `SELECT si.planned_end, si.baseline_end, si.forecast_end
           FROM stage_instance si JOIN journey_instance j ON j.id = si.journey_id
          WHERE j.booking_id = $1 AND si.planned_end <> si.baseline_end`,
        [bookingId]
      );
      expect(stages.rows.length, bookingId).toBeGreaterThan(0);
      for (const s of stages.rows) {
        expect(String(s.forecast_end)).toBe(String(s.planned_end));
      }
      const rev = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM timeline_forecast_revision r
           JOIN journey_instance j ON j.id = r.journey_id WHERE j.booking_id = $1`,
        [bookingId]
      );
      expect(rev.rows[0]!.n, bookingId).toBeGreaterThan(0);
    }
  });
});

describe("6.8 one writer per case", () => {
  beforeAll(async () => {
    await initDb();
  }, 180_000);

  it("completeHandover keeps the existing handover_record.id", async () => {
    const created = await loadOrCreateHandover("b_v114");
    await db.query(`UPDATE unit SET sale_status = 'registered' WHERE id = (SELECT unit_id FROM booking WHERE id = 'b_v114')`);
    await completeHandover("b_v114", superAdminCtx);
    const after = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM handover_record WHERE booking_id = 'b_v114'`
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.id).toBe(created.id);
    expect(after.rows[0]!.status).toBe("completed");
  });

  it("completeRegistration keeps the existing registration_case.id when finance allows", async () => {
    const created = await loadOrCreateRegistration("b_v111");
    try {
      await completeRegistration("b_v111", "SRO/P6/1", superAdminCtx);
    } catch {
      // finance/docs may still block — id must not have been replaced either way
    }
    const after = await db.query<{ id: string }>(`SELECT id FROM registration_case WHERE booking_id = 'b_v111'`);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.id).toBe(created.id);
  });

  it("qa.ts and legal-docs.ts no longer INSERT ON CONFLICT as a second producer", () => {
    const qa = readFileSync(join(SRC, "qa.ts"), "utf8");
    const legal = readFileSync(join(SRC, "legal-docs.ts"), "utf8");
    expect(qa).not.toMatch(/INSERT INTO handover_record[\s\S]*ON CONFLICT \(booking_id\)/);
    expect(legal).not.toMatch(/INSERT INTO registration_case[\s\S]*ON CONFLICT \(booking_id\)/);
  });
});
