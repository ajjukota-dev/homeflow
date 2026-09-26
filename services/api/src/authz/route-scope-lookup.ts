import { query } from "../db";
import { runAsSystem } from "../db/rls-context";

// System lookup so a row outside the actor's RLS still resolves to its project.
// null project_id means an org-wide config row (visible to whoever passed the role check).
// undefined means the id is not a row of this entity.

const LOOKUP: Record<string, string> = {
  project: `SELECT id AS project_id FROM project WHERE id = $1`,
  booking: `SELECT project_id FROM booking WHERE id = $1`,
  unit: `SELECT project_id FROM unit WHERE id = $1`,
  demand: `SELECT project_id FROM demand WHERE id = $1`,
  customer: `SELECT b.project_id
               FROM booking_applicant a
               JOIN booking b ON b.id = a.booking_id
              WHERE a.customer_id = $1
              ORDER BY (b.status = 'active') DESC, b.created_at DESC
              LIMIT 1`,
  action: `SELECT COALESCE(a.project_id, b.project_id) AS project_id
             FROM action a
             LEFT JOIN booking b ON b.id = a.booking_id
            WHERE a.id = $1`,
  change_request: `SELECT project_id FROM change_request WHERE id = $1`,
  qa_inspection: `SELECT project_id FROM qa_inspection WHERE id = $1`,
  snag: `SELECT project_id FROM snag WHERE id = $1`,
  hold: `SELECT project_id FROM change_window_hold WHERE id = $1`,
  warranty_case: `SELECT project_id FROM warranty_case WHERE id = $1`,
  loan_case: `SELECT project_id FROM loan_case WHERE id = $1`,
  receipt: `SELECT project_id FROM receipt WHERE id = $1`,
  waiver: `SELECT b.project_id FROM waiver w JOIN booking b ON b.id = w.booking_id WHERE w.id = $1`,
  tds_record: `SELECT b.project_id FROM tds_record t JOIN booking b ON b.id = t.booking_id WHERE t.id = $1`,
  journey: `SELECT project_id FROM journey_instance WHERE id = $1`,
  task: `SELECT j.project_id
           FROM task_instance ti
           JOIN stage_instance si ON si.id = ti.stage_instance_id
           JOIN journey_instance j ON j.id = si.journey_id
          WHERE ti.id = $1`,
  escalation: `SELECT COALESCE(e.project_id, a.project_id, b.project_id) AS project_id
                 FROM escalation e
                 LEFT JOIN action a ON a.id = e.action_id
                 LEFT JOIN booking b ON b.id = a.booking_id
                WHERE e.id = $1`,
  commitment: `SELECT project_id FROM commitment WHERE id = $1`,
  post_handover_case: `SELECT project_id FROM post_handover_case WHERE id = $1`,
  intervention: `SELECT project_id FROM intervention WHERE id = $1`,
  payment_plan: `SELECT project_id FROM payment_plan WHERE id = $1`,
  forecast_scenario: `SELECT project_id FROM forecast_scenario WHERE id = $1`,
  forecast_line: `SELECT project_id FROM forecast_line WHERE id = $1`,
  specification_baseline: `SELECT project_id FROM specification_baseline WHERE id = $1`,
  spec_revision: `SELECT project_id FROM spec_revision WHERE id = $1`,
  prospect: `SELECT project_id FROM prospect WHERE id = $1`,
  quotation: `SELECT cr.project_id FROM quotation q JOIN change_request cr ON cr.id = q.cr_id WHERE q.id = $1`,
  customer_document: `SELECT b.project_id FROM customer_document d JOIN booking b ON b.id = d.booking_id WHERE d.id = $1`,
  customer_update: `SELECT b.project_id FROM customer_update u JOIN booking b ON b.id = u.booking_id WHERE u.id = $1`,
  communication: `SELECT COALESCE(c.project_id, b.project_id) AS project_id
                    FROM communication c
                    LEFT JOIN booking b ON b.id = c.booking_id
                   WHERE c.id = $1`,
  communication_template: `SELECT project_id FROM communication_template WHERE id = $1`,
  doc_factory_template: `SELECT project_id FROM doc_factory_template WHERE id = $1`,
  journey_template: `SELECT project_id FROM journey_template WHERE id = $1`,
  journey_template_version: `SELECT t.project_id
                               FROM journey_template_version v
                               JOIN journey_template t ON t.id = v.template_id
                              WHERE v.id = $1`,
  external_dependency: `SELECT project_id FROM external_dependency WHERE id = $1`,
  unit_gate_exception: `SELECT u.project_id FROM unit_gate_exception e JOIN unit u ON u.id = e.unit_id WHERE e.id = $1`,
  progress_bulk: `SELECT project_id FROM progress_bulk_update WHERE id = $1`,
  advocacy: `SELECT b.project_id FROM advocacy a JOIN booking b ON b.id = a.booking_id WHERE a.id = $1`,
  checkin_record: `SELECT b.project_id FROM checkin_record c JOIN booking b ON b.id = c.booking_id WHERE c.id = $1`,
  customer_check_in: `SELECT b.project_id FROM customer_check_in c JOIN booking b ON b.id = c.booking_id WHERE c.id = $1`,
  document_deviation: `SELECT d.project_id
                         FROM document_deviation dv
                         JOIN doc_factory_document d ON d.id = dv.document_id
                        WHERE dv.id = $1`,
  cash_target: `SELECT project_id FROM cash_target WHERE id = $1`,
  customer_visibility_rule: `SELECT project_id FROM customer_visibility_rule WHERE id = $1`,
  dlp_policy: `SELECT project_id FROM dlp_policy WHERE id = $1`,
  handover_checklist_rule: `SELECT project_id FROM handover_checklist_rule WHERE id = $1`,
  sales_policy: `SELECT project_id FROM sales_policy WHERE id = $1`,
};

async function one(sql: string, id: string): Promise<string | null | undefined> {
  const r = await runAsSystem(() => query<{ project_id: string | null }>(sql, [id]));
  if (!r.rows[0]) return undefined;
  return r.rows[0].project_id;
}

/** Project that owns this id, null when the row is org-wide, undefined when it is not this entity. */
export async function projectIdOf(entity: string, id: string): Promise<string | null | undefined> {
  if (entity === "document") {
    const factory = await one(`SELECT project_id FROM doc_factory_document WHERE id = $1`, id);
    if (factory !== undefined) return factory;
    return one(`SELECT project_id FROM generated_document WHERE id = $1`, id);
  }
  const sql = LOOKUP[entity];
  if (!sql) return undefined;
  return one(sql, id);
}
