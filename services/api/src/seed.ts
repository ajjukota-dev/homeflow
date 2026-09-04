import type { PGlite } from "@electric-sql/pglite";
import { seedLifecycleDemo } from "./seed-lifecycle";

// Configuration + sample project data (not hard-coded UI values).

async function setState(db: PGlite, unitId: string, component: string, state: string) {
  await db.query(
    `UPDATE unit_progress SET state_code=$1, updated_at=now() WHERE unit_id=$2 AND component_code=$3`,
    [state, unitId, component]
  );
}

async function seedPlan(db: PGlite, planId: string, projectId: string | null) {
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

export async function seed(db: PGlite) {
  await db.exec(`INSERT INTO project (id, code, name, rera_reg_no, escrow_note) VALUES
    ('p_eastcrest','EASTCREST','East Crest','PRM/KA/RERA/1251/446/PR/171015/000123',
     'Booking amounts sit in a designated escrow account until they are due under RERA.');`);

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
    INSERT INTO overdue_reason (code, label, next_action) VALUES
      ('customer_delay','Customer asked for more time','Call the customer'),
      ('loan_stuck','Bank disbursement delayed','Chase the bank'),
      ('unresponsive','No response to reminders','Escalate to the RM'),
      ('cheque_bounce','Instrument returned','Request a fresh instrument'),
      ('dispute_raised','Amount is disputed','Resolve the dispute');
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

  await db.exec(`
    INSERT INTO unit (id, project_id, unit_number, unit_type, facing) VALUES
      ('u_v101','p_eastcrest','V101','3BHK','East'),
      ('u_v108','p_eastcrest','V108','3BHK','North'),
      ('u_v104','p_eastcrest','V104','3BHK','West'),
      ('u_v110','p_eastcrest','V110','3BHK','East'),
      ('u_v111','p_eastcrest','V111','3BHK','South'),
      ('u_v112','p_eastcrest','V112','3BHK','West'),
      ('u_v113','p_eastcrest','V113','3BHK','North');
  `);

  await db.exec(`
    INSERT INTO unit_progress (unit_id, component_code, state_code)
    SELECT u.id, c.code, 'not_started' FROM unit u CROSS JOIN component_definition c;
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

  await seedMoneyDemo(db);
  await seedLifecycleDemo(db);
}

async function seedMoneyDemo(db: PGlite) {
  // V110 — Karthik: settled + due + overdue + true-risk + scheduled
  await db.exec(`
    INSERT INTO customer (id, display_name, primary_phone, kyc_status)
    VALUES ('c_karthik','Karthik Iyer','9845011122','verified');
    INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, rm_owner, payment_plan_id)
    VALUES ('b_v110','p_eastcrest','u_v110','BK-V110','active',12000000,100,'Priya Nair','plan_eastcrest');
    INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, phone, pan)
    VALUES ('a_v110','b_v110','c_karthik','Karthik Iyer','primary','9845011122','ABCDE1234F');
    UPDATE unit SET sale_status = 'booked' WHERE id = 'u_v110';

    INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, construction_trigger_event, sequence, amount, due_date, status, overdue_reason_code, loan_dependent) VALUES
      ('d_v110_1','b_v110','p_eastcrest','booking_token','Booking amount',NULL,1,1200000,CURRENT_DATE - 60,'settled',NULL,false),
      ('d_v110_2','b_v110','p_eastcrest','structure_milestone','Structure complete','structure:complete',2,3600000,CURRENT_DATE,'due',NULL,false),
      ('d_v110_3','b_v110','p_eastcrest','mep_milestone','MEP first-fix complete','mep_first_fix:complete',3,2400000,CURRENT_DATE - 10,'overdue','customer_delay',false),
      ('d_v110_4','b_v110','p_eastcrest','flooring_milestone','Flooring laid','flooring:complete',4,2400000,CURRENT_DATE - 70,'overdue','unresponsive',false),
      ('d_v110_5','b_v110','p_eastcrest','possession_milestone','Possession','finishing:verified',5,2400000,NULL,'scheduled',NULL,false);

    INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, received_at, status, idempotency_key)
    VALUES ('r_v110_1','b_v110','p_eastcrest','d_v110_1',1200000,'neft',CURRENT_DATE - 50,'reconciled','seed-v110-booking');
  `);

  // V111 — Meera: loan-dependent + disputed + PTP
  await db.exec(`
    INSERT INTO customer (id, display_name, primary_phone, kyc_status)
    VALUES ('c_meera','Meera Krishnan','9845033344','verified');
    INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, rm_owner, payment_plan_id)
    VALUES ('b_v111','p_eastcrest','u_v111','BK-V111','active',8000000,100,'Priya Nair','plan_eastcrest');
    INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, phone, pan)
    VALUES ('a_v111','b_v111','c_meera','Meera Krishnan','primary','9845033344','XYZAB1234C');
    UPDATE unit SET sale_status = 'booked' WHERE id = 'u_v111';
    INSERT INTO loan_case (id, booking_id, lender, sanctioned_amount, status)
    VALUES ('lc_v111','b_v111','HDFC','6000000','docs_pending');

    INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, construction_trigger_event, sequence, amount, due_date, status, overdue_reason_code, loan_dependent) VALUES
      ('d_v111_1','b_v111','p_eastcrest','booking_token','Booking amount',NULL,1,800000,CURRENT_DATE,'due',NULL,true),
      ('d_v111_2','b_v111','p_eastcrest','structure_milestone','Structure complete','structure:complete',2,2400000,CURRENT_DATE - 5,'disputed','dispute_raised',false),
      ('d_v111_3','b_v111','p_eastcrest','mep_milestone','MEP first-fix complete','mep_first_fix:complete',3,1600000,CURRENT_DATE + 5,'due',NULL,false),
      ('d_v111_4','b_v111','p_eastcrest','flooring_milestone','Flooring laid','flooring:complete',4,1600000,NULL,'scheduled',NULL,false),
      ('d_v111_5','b_v111','p_eastcrest','possession_milestone','Possession','finishing:verified',5,1600000,NULL,'scheduled',NULL,false);

    INSERT INTO promise_to_pay (id, demand_id, expected_date, expected_amount)
    VALUES ('ptp_v111_3','d_v111_3',CURRENT_DATE + 12,1600000);
  `);
}
