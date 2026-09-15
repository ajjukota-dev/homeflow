import type { DbClient } from "./db/types";
import { seedLifecycleDemo } from "./seed-lifecycle";
import { seedCanonicalDemo } from "./seed-canonical";
import { seedEastCrestJourney } from "./seed/demo-east-crest";
import { seedStaffUsers } from "./seed/users";
import { seedOccupantsViaHandlers } from "./seed/occupants-via-handlers";
import { nextCode } from "./model/codes";

// Configuration + sample project data (not hard-coded UI values).

async function setState(db: DbClient, unitId: string, component: string, state: string) {
  await db.query(
    `UPDATE unit_progress SET state_code=$1, updated_at=now() WHERE unit_id=$2 AND component_code=$3`,
    [state, unitId, component]
  );
}

async function seedPlan(db: DbClient, planId: string, projectId: string | null) {
  await db.query(`INSERT INTO payment_plan (id, project_id, name, basis) VALUES ($1,$2,$3,$4)`, [
    planId,
    projectId,
    "Construction-linked plan",
    "construction_linked",
  ]);
  await db.exec(`
    INSERT INTO payment_plan_milestone (id, plan_id, milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration) VALUES
      ('${planId}_m1','${planId}','booking_token','Booking amount',NULL,1,10),
      ('${planId}_m2','${planId}','structure_milestone','Structure complete','structure:complete',2,30),
      ('${planId}_m3','${planId}','mep_milestone','MEP first-fix complete','mep_first_fix:complete',3,20),
      ('${planId}_m4','${planId}','flooring_milestone','Flooring laid','flooring:complete',4,20),
      ('${planId}_m5','${planId}','possession_milestone','Possession','finishing:verified',5,20);
  `);
}

export async function seed(db: DbClient) {
  await db.exec(`INSERT INTO project
      (id, code, name, rera_reg_no, escrow_note, portfolio_id, product_type, legal_entity,
       jurisdiction, escrow_account_ref, launch_date, planned_handover_date, status)
    VALUES
      ('p_eastcrest','EASTCREST','East Crest','PRM/KA/RERA/1251/446/PR/171015/000123',
       'Booking amounts sit in a designated escrow account until they are due under RERA.',
       'portfolio_pranava','VILLA','Pranava Housing LLP','Bengaluru Urban, Karnataka',
       'ESCROW/EASTCREST/01', '2024-01-15', '2026-12-31', 'ACTIVE');`);
  await db.query(
    `INSERT INTO project_hierarchy_node (id, project_id, kind, code, name, sort_order)
     VALUES ('node_eastcrest_p1','p_eastcrest','PHASE','P1','Phase 1 — Villas',1)`
  );

  await db.exec(`
    INSERT INTO component_definition (code, label, sort_order) VALUES
      ('structure','Structure / RCC',1),
      ('mep_first_fix','MEP first-fix',2),
      ('flooring','Flooring',3),
      ('finishing','Finishing & paint',4);
  `);

  await db.exec(`
    INSERT INTO change_category (code, customer_label, customer_visible, sort_order) VALUES
      ('kitchen_layout','Kitchen layout',true,1),
      ('electrical','Electrical additions',true,2),
      ('flooring_selection','Flooring selection',true,3),
      ('structural','Structural changes',false,4);
  `);

  await db.exec(`
    INSERT INTO change_gate_rule (category_code, trigger_component_code, min_state, resulting_state) VALUES
      ('electrical','mep_first_fix','in_progress','CLOSING'),
      ('electrical','mep_first_fix','complete','EXCEPTION_ONLY'),
      ('kitchen_layout','mep_first_fix','in_progress','CONDITIONAL'),
      ('kitchen_layout','mep_first_fix','complete','EXCEPTION_ONLY'),
      ('flooring_selection','flooring','in_progress','CONDITIONAL'),
      ('flooring_selection','flooring','complete','EXCEPTION_ONLY'),
      ('structural','structure','complete','HARD_CLOSED');
  `);

  await db.exec(`
    INSERT INTO overdue_reason (code, label, next_action, category, default_action_type) VALUES
      ('customer_delay','Customer asked for more time','Call the customer','CUSTOMER_CASH','exec_simple'),
      ('loan_stuck','Bank disbursement delayed','Chase the bank','LOAN_DELAY','exec_simple'),
      ('unresponsive','No response to reminders','Escalate to the RM','COMMUNICATION_GAP','exec_simple'),
      ('cheque_bounce','Instrument returned','Request a fresh instrument','CUSTOMER_CASH','exec_simple'),
      ('dispute_raised','Amount is disputed','Resolve the dispute','DISPUTE','exec_simple');
  `);

  await seedPlan(db, "plan_standard", null);
  await seedPlan(db, "plan_eastcrest", "p_eastcrest");
  await db.exec(
    `INSERT INTO collection_policy (project_id, true_risk_max_probability, registration_min_pct)
     VALUES ('p_eastcrest', 0.40, 0.70);`
  );
  await db.exec(
    `INSERT INTO handover_policy (project_id, readiness_threshold, minor_snag_max, dlp_months, checkin_days)
     VALUES ('p_eastcrest', 80, 2, 12, '7,30,90');`
  );

  const villaUnits: [string, string, string, number][] = [
    ["u_v101", "V101", "East", 12000000],
    ["u_v108", "V108", "North", 11500000],
    ["u_v104", "V104", "West", 11800000],
    ["u_v110", "V110", "East", 12000000],
    ["u_v111", "V111", "South", 8000000],
    ["u_v112", "V112", "West", 10000000],
    ["u_v113", "V113", "North", 9500000],
  ];
  for (const [id, unitNumber, facing, basePrice] of villaUnits) {
    const code = await nextCode(db, "UNT");
    await db.query(
      `INSERT INTO unit (id, project_id, unit_number, unit_type, facing, code, hierarchy_node_id,
         product_type, carpet_area_sqft, base_price_inr)
       VALUES ($1,'p_eastcrest',$2,'3BHK',$3,$4,'node_eastcrest_p1','VILLA',2100,$5)`,
      [id, unitNumber, facing, code, basePrice]
    );
  }

  // 09 rule 1: an APPROVED specification_baseline for East Crest's own VILLA units, plus the
  // unit_specification + revision-0 (BASELINE, RELEASED) row each unit needs to point at it.
  // ensureUnitSpecification's own subscriber (specification/subscribers.ts) only fires on the
  // real `booking.status_changed`/`booking.created` EVENTS — this seed file inserts bookings via
  // raw SQL below (never through the event-emitting handlers), so no subscriber ever ran for any
  // seeded booking. Without this, `unit_specification` stays empty for every East Crest unit and
  // 18's `releaseChangeRequest` can never succeed against seeded demo data (found while building
  // 18's own UI — see docs/specs/09-specification-revisions.md's 2026-09-07 Build note). Seeded
  // directly at the terminal state, same "no live subscriber runs against seed data" precedent as
  // this file's own bulk `unit_progress` cross-join below.
  await db.query(
    `INSERT INTO specification_baseline (id, project_id, product_type, unit_type, name, version, items, status, approved_by, approved_at, created_by)
     VALUES ('sb_eastcrest_villa','p_eastcrest','VILLA',NULL,'East Crest Villa — Standard Specification',1,$1::jsonb,'APPROVED','user_site',now(),'user_site')`,
    [JSON.stringify({
      structure: { spec: "RCC framed structure, M25 grade concrete" },
      flooring: { spec: "800x800mm vitrified tiles", brand_model: "Kajaria Eternity" },
      kitchen: { spec: "Modular kitchen with granite countertop" },
      wardrobes: { spec: "Factory-finished modular wardrobes in all bedrooms" },
    })]
  );
  for (const [id] of villaUnits) {
    await db.query(
      `INSERT INTO spec_revision (id, unit_id, project_id, revision_no, kind, items_delta, status, released_at, released_by, created_by)
       VALUES ($1,$2,'p_eastcrest',0,'BASELINE','{}'::jsonb,'RELEASED',now(),'user_site','user_site')`,
      [`rev_${id}_0`, id]
    );
    await db.query(
      `INSERT INTO unit_specification (unit_id, baseline_id, current_revision_id) VALUES ($1,'sb_eastcrest_villa',$2)`,
      [id, `rev_${id}_0`]
    );
    await db.query(`UPDATE unit SET specification_baseline_id = 'sb_eastcrest_villa' WHERE id = $1`, [id]);
  }

  // Second demo project (villa + plot units) — inserted before the bulk unit_progress
  // statement below so its units are covered by the same cross-join, same as East Crest's.
  await seedCanonicalDemo(db);

  await db.exec(`
    INSERT INTO unit_progress (unit_id, component_code, state_code)
    SELECT u.id, c.code, 'not_started' FROM unit u CROSS JOIN component_definition c
     WHERE NOT EXISTS (SELECT 1 FROM unit_progress p WHERE p.unit_id = u.id);
  `);
  await setState(db, "u_v108", "structure", "complete");
  await setState(db, "u_v108", "mep_first_fix", "in_progress");
  await setState(db, "u_v104", "structure", "complete");
  await setState(db, "u_v104", "mep_first_fix", "complete");
  await setState(db, "u_v104", "flooring", "complete");
  await setState(db, "u_v110", "structure", "complete");
  await setState(db, "u_v110", "mep_first_fix", "complete");
  // d_v110_4 (flooring milestone) is overdue, i.e. its flooring:complete trigger has
  // fired — the seed must agree, or T2 why-now would have to lie about the site state.
  await setState(db, "u_v110", "flooring", "complete");
  await setState(db, "u_v111", "structure", "in_progress");
  for (const uid of ["u_v112", "u_v113"]) {
    await setState(db, uid, "structure", "verified");
    await setState(db, uid, "mep_first_fix", "verified");
    await setState(db, uid, "flooring", "verified");
    await setState(db, uid, "finishing", "verified");
  }
  await db.exec(`UPDATE unit SET utilities_ready = true WHERE id IN ('u_v112','u_v113');`);

  await seedEastCrestJourney(db);
  await seedStaffUsers();
  await seedLifecycleDemo(db);
  await seedOccupantsViaHandlers();
}
