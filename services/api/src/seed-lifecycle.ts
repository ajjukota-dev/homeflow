import type { DbClient } from "./db/types";

const AOS_BODY = `AGREEMENT FOR SALE

This Agreement for Sale is made for Villa {{unit_number}} ({{unit_type}}, {{facing}} facing) at {{project_name}}.

Purchaser: {{applicant_name}} (PAN {{pan}}).
Booking {{booking_number}}.
Total consideration ₹{{consideration}}.
`;

const AOS_FIELDS = JSON.stringify([
  { key: "applicant_name", label: "Applicant name", source_ref: "booking_applicant.display_name", mandatory: true },
  { key: "pan", label: "PAN", source_ref: "booking_applicant.pan", mandatory: true },
  { key: "unit_number", label: "Unit number", source_ref: "unit.unit_number", mandatory: true },
  { key: "consideration", label: "Consideration", source_ref: "booking.total_consideration", mandatory: true },
]);

export async function seedLifecycleDemo(db: DbClient) {
  await db.query(
    `INSERT INTO document_template
      (id, document_family, project_id, property_type, transaction_type, status, version, body, mandatory_fields, checksum)
     VALUES ('tpl_aos', 'AOS', NULL, 'villa', 'sale', 'approved', 1, $1, $2::jsonb, 'aos-v1')`,
    [AOS_BODY, AOS_FIELDS]
  );

  await db.exec(`
    INSERT INTO qa_evidence (unit_id, component_code, qa_verified)
    SELECT u.id, c.code, false FROM unit u CROSS JOIN component_definition c;
    UPDATE qa_evidence SET qa_verified = true, evidence_note = 'Photo + checklist signed', verified_at = now()
     WHERE unit_id = 'u_v110' AND component_code = 'structure';
    UPDATE qa_evidence SET qa_verified = true, evidence_note = 'Photo + checklist signed', verified_at = now()
     WHERE unit_id IN ('u_v112','u_v113');
    INSERT INTO snag (id, unit_id, project_id, severity, location, trade, description, status) VALUES
      ('s_v110_1','u_v110','p_eastcrest','minor','Foyer','paint','Paint touch-up on the foyer wall','open'),
      ('s_v111_1','u_v111','p_eastcrest','critical','Electrical panel','electrical','Exposed live wiring at the distribution board','open');
    INSERT INTO home_passport_item (id, unit_id, project_id, category, name, paint_tile_code, customer_facing, approved)
    VALUES ('pp_v110_paint','u_v110','p_eastcrest','finishes','Living-room wall colour','Warm Sand 04', true, true);
  `);

  const aosV110 =
    "AGREEMENT FOR SALE\n\nThis Agreement for Sale is made for Villa V110 (3BHK, East facing) at East Crest.\n\nPurchaser: Karthik Iyer (PAN ABCDE1234F).\nBooking BK-V110.\nTotal consideration ₹12000000.\n";
  await db.query(
    `INSERT INTO generated_document
      (id, template_id, booking_id, project_id, unit_id, document_family, status, version, snapshot, body_rendered, checksum)
     VALUES ('doc_v110_aos','tpl_aos','b_v110','p_eastcrest','u_v110','AOS','executed',1,$1::jsonb,$2,'chk-v110')`,
    [
      JSON.stringify({
        applicant_name: "Karthik Iyer",
        pan: "ABCDE1234F",
        unit_number: "V110",
        unit_type: "3BHK",
        facing: "East",
        project_name: "East Crest",
        booking_number: "BK-V110",
        consideration: "12000000",
      }),
      aosV110,
    ]
  );
  await db.exec(`
    INSERT INTO registration_case (id, booking_id, project_id, status)
    VALUES ('reg_v110','b_v110','p_eastcrest','readiness_in_progress');
  `);

  await seedKeysVilla(db);
  await seedHandedOverVilla(db);
}

async function seedKeysVilla(db: DbClient) {
  await db.exec(`
    INSERT INTO customer (id, display_name, primary_phone, kyc_status)
    VALUES ('c_ananya','Ananya Rao','9845055566','verified');
    INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, rm_owner, payment_plan_id)
    VALUES ('b_v112','p_eastcrest','u_v112','BK-V112','active',10000000,100,'Priya Nair','plan_eastcrest');
    INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, phone, pan)
    VALUES ('a_v112','b_v112','c_ananya','Ananya Rao','primary','9845055566','PQRST6789L');
    UPDATE unit SET sale_status = 'registered' WHERE id = 'u_v112';

    INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, construction_trigger_event, sequence, amount, due_date, status) VALUES
      ('d_v112_1','b_v112','p_eastcrest','booking_token','Booking amount',NULL,1,1000000,CURRENT_DATE - 200,'settled'),
      ('d_v112_2','b_v112','p_eastcrest','structure_milestone','Structure complete','structure:complete',2,3000000,CURRENT_DATE - 120,'settled'),
      ('d_v112_3','b_v112','p_eastcrest','mep_milestone','MEP first-fix complete','mep_first_fix:complete',3,2000000,CURRENT_DATE - 80,'settled'),
      ('d_v112_4','b_v112','p_eastcrest','flooring_milestone','Flooring laid','flooring:complete',4,2000000,CURRENT_DATE - 40,'settled'),
      ('d_v112_5','b_v112','p_eastcrest','possession_milestone','Possession','finishing:verified',5,2000000,CURRENT_DATE,'due');

    INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, received_at, status, idempotency_key) VALUES
      ('r_v112_1','b_v112','p_eastcrest','d_v112_1',1000000,'neft',CURRENT_DATE - 190,'reconciled','seed-v112-1'),
      ('r_v112_2','b_v112','p_eastcrest','d_v112_2',3000000,'neft',CURRENT_DATE - 110,'reconciled','seed-v112-2'),
      ('r_v112_3','b_v112','p_eastcrest','d_v112_3',2000000,'neft',CURRENT_DATE - 70,'reconciled','seed-v112-3'),
      ('r_v112_4','b_v112','p_eastcrest','d_v112_4',2000000,'neft',CURRENT_DATE - 30,'reconciled','seed-v112-4'),
      ('r_v112_5','b_v112','p_eastcrest','d_v112_5',1000000,'neft',CURRENT_DATE - 2,'reconciled','seed-v112-5');

    INSERT INTO generated_document (id, template_id, booking_id, project_id, unit_id, document_family, status, version, snapshot, body_rendered, checksum)
    VALUES ('doc_v112_aos','tpl_aos','b_v112','p_eastcrest','u_v112','AOS','executed',1,
      '{"applicant_name":"Ananya Rao","pan":"PQRST6789L","unit_number":"V112","consideration":"10000000"}',
      'Agreement for Villa V112 with Ananya Rao.','chk-v112');
    INSERT INTO registration_case (id, booking_id, project_id, status, sro_reference, completed_at)
    VALUES ('reg_v112','b_v112','p_eastcrest','completed','SRO/BNG/2026/4412', now());
  `);
}

async function seedHandedOverVilla(db: DbClient) {
  await db.exec(`
    INSERT INTO customer (id, display_name, primary_phone, kyc_status)
    VALUES ('c_rohan','Rohan Desai','9845077788','verified');
    INSERT INTO booking (id, project_id, unit_id, booking_number, status, total_consideration, completeness_score, rm_owner, payment_plan_id)
    VALUES ('b_v113','p_eastcrest','u_v113','BK-V113','active',9500000,100,'Priya Nair','plan_eastcrest');
    INSERT INTO booking_applicant (id, booking_id, customer_id, display_name, role, phone, pan)
    VALUES ('a_v113','b_v113','c_rohan','Rohan Desai','primary','9845077788','LMNOP4321K');
    UPDATE unit SET sale_status = 'handed_over' WHERE id = 'u_v113';

    INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status) VALUES
      ('d_v113_1','b_v113','p_eastcrest','booking_token','Booking amount',1,950000,CURRENT_DATE - 400,'settled'),
      ('d_v113_2','b_v113','p_eastcrest','structure_milestone','Structure complete',2,2850000,CURRENT_DATE - 300,'settled'),
      ('d_v113_3','b_v113','p_eastcrest','mep_milestone','MEP first-fix complete',3,1900000,CURRENT_DATE - 200,'settled'),
      ('d_v113_4','b_v113','p_eastcrest','flooring_milestone','Flooring laid',4,1900000,CURRENT_DATE - 120,'settled'),
      ('d_v113_5','b_v113','p_eastcrest','possession_milestone','Possession',5,1900000,CURRENT_DATE - 40,'settled');
    INSERT INTO receipt (id, booking_id, project_id, demand_id, amount, mode, received_at, status, idempotency_key) VALUES
      ('r_v113_1','b_v113','p_eastcrest','d_v113_1',950000,'neft',CURRENT_DATE - 390,'reconciled','seed-v113-1'),
      ('r_v113_2','b_v113','p_eastcrest','d_v113_2',2850000,'neft',CURRENT_DATE - 290,'reconciled','seed-v113-2'),
      ('r_v113_3','b_v113','p_eastcrest','d_v113_3',1900000,'neft',CURRENT_DATE - 190,'reconciled','seed-v113-3'),
      ('r_v113_4','b_v113','p_eastcrest','d_v113_4',1900000,'neft',CURRENT_DATE - 110,'reconciled','seed-v113-4'),
      ('r_v113_5','b_v113','p_eastcrest','d_v113_5',1900000,'neft',CURRENT_DATE - 30,'reconciled','seed-v113-5');

    INSERT INTO generated_document (id, template_id, booking_id, project_id, unit_id, document_family, status, version, snapshot, body_rendered, checksum)
    VALUES ('doc_v113_aos','tpl_aos','b_v113','p_eastcrest','u_v113','AOS','archived',1,
      '{"applicant_name":"Rohan Desai","pan":"LMNOP4321K","unit_number":"V113","consideration":"9500000"}',
      'Agreement for Villa V113 with Rohan Desai.','chk-v113');
    INSERT INTO registration_case (id, booking_id, project_id, status, sro_reference, completed_at)
    VALUES ('reg_v113','b_v113','p_eastcrest','completed','SRO/BNG/2026/3301', now() - interval '45 days');

    INSERT INTO handover_record (id, booking_id, unit_id, project_id, status, completed_at)
    VALUES ('ho_v113','b_v113','u_v113','p_eastcrest','completed', now() - interval '20 days');
    INSERT INTO dlp_window (id, unit_id, booking_id, project_id, dlp_start, dlp_end, status, policy_months)
    VALUES ('dlp_v113','u_v113','b_v113','p_eastcrest', (CURRENT_DATE - 20), (CURRENT_DATE - 20) + interval '12 months', 'active', 12);

    INSERT INTO home_passport_item (id, unit_id, project_id, category, name, brand_model, warranty_months, customer_facing, approved) VALUES
      ('pp_v113_ac','u_v113','p_eastcrest','appliance','Living-room AC','Daikin 1.5T FTKF',12,true,true),
      ('pp_v113_wh','u_v113','p_eastcrest','appliance','Water heater','Racold 25L',24,true,true);
    INSERT INTO home_passport_item (id, unit_id, project_id, category, name, paint_tile_code, customer_facing, approved)
    VALUES ('pp_v113_paint','u_v113','p_eastcrest','finishes','Bedroom wall colour','Soft Clay 12',true,true);

    INSERT INTO warranty_case (id, unit_id, booking_id, project_id, passport_item_id, category, trade, severity, description, coverage, status)
    VALUES ('w_v113_1','u_v113','b_v113','p_eastcrest','pp_v113_wh','plumbing','plumbing','minor',
            'Guest-bath mixer drips overnight','dlp','open');
    INSERT INTO service_history (id, unit_id, event_type, description, actor, occurred_at) VALUES
      ('sh_v113_1','u_v113','handover.completed','Keys issued and Home Passport handed over','Priya Nair', now() - interval '20 days'),
      ('sh_v113_2','u_v113','warranty.case.opened','Guest-bath mixer drips overnight','Rohan Desai', now() - interval '3 days');
    INSERT INTO checkin_record (id, booking_id, day, status) VALUES
      ('ci_v113_7','b_v113',7,'scheduled'),
      ('ci_v113_30','b_v113',30,'scheduled'),
      ('ci_v113_90','b_v113',90,'scheduled');
  `);
}
