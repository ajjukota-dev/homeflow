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

/** Config + QA fixtures. Bookings/demands/AOS/handover for V110–V113 are created by handlers. */
export async function seedLifecycleDemo(db: DbClient) {
  await db.query(
    `INSERT INTO document_template
      (id, document_family, project_id, property_type, transaction_type, status, version, body, mandatory_fields, checksum)
     VALUES ('tpl_aos', 'AOS', NULL, 'villa', 'sale', 'approved', 1, $1, $2::jsonb, 'aos-v1')`,
    [AOS_BODY, AOS_FIELDS]
  );

  await db.exec(`
    INSERT INTO qa_evidence (unit_id, component_code, qa_verified)
    SELECT u.id, c.code, false FROM unit u CROSS JOIN component_definition c
     WHERE NOT EXISTS (SELECT 1 FROM qa_evidence q WHERE q.unit_id = u.id AND q.component_code = c.code);
    UPDATE qa_evidence SET qa_verified = true, evidence_note = 'Photo + checklist signed', verified_at = now()
     WHERE unit_id = 'u_v110' AND component_code = 'structure';
    UPDATE qa_evidence SET qa_verified = true, evidence_note = 'Photo + checklist signed', verified_at = now()
     WHERE unit_id IN ('u_v112','u_v113');
    INSERT INTO snag (id, unit_id, project_id, severity, location, trade, description, status) VALUES
      ('s_v110_1','u_v110','p_eastcrest','minor','Foyer','paint','Paint touch-up on the foyer wall','open');
    INSERT INTO home_passport_item (id, unit_id, project_id, category, name, paint_tile_code, customer_facing, approved)
    VALUES ('pp_v110_paint','u_v110','p_eastcrest','finishes','Living-room wall colour','Warm Sand 04', true, true);
    INSERT INTO contractor (id, name, trade, contact) VALUES
      ('con_sunrise_plumbing','Sunrise Plumbing & Waterproofing','plumbing','contact@sunriseplumbing.example'),
      ('con_voltage_electricals','Voltage Electricals','electrical','service@voltageelectricals.example'),
      ('con_eastcrest_fm','East Crest FM Services','general','fm@eastcrestservices.example');
  `);
}
