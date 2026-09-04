import { randomUUID } from "node:crypto";
import { db } from "./db";
import { readinessScore } from "./readiness";
import { evaluateHandover } from "./handover";
import { bookingFinance } from "./finance";
import { onHandoverCompleted } from "./warranty";
import { componentsFor } from "./qa-evidence";
import { listSnagsForUnit, snagCounts, type SnagRow } from "./qa-snags";

// QA evidence, snags, and H9 handover eligibility (qa/spec.md).

export async function unitReadiness(unitId: string) {
  const comps = await componentsFor(unitId);
  const { critical } = await snagCounts(unitId);
  const score = readinessScore(
    comps.map((c) => ({ code: c.code, qa_verified: Boolean(c.qa_verified) })),
    critical
  );
  return {
    unit_id: unitId,
    ...score,
    components: comps,
    qa_approved: comps.length > 0 && comps.every((c) => c.qa_verified),
    critical_snags: critical,
  };
}

export async function projectReadiness(projectId: string) {
  const units = await db.query<{
    id: string;
    unit_number: string;
    booking_id: string | null;
    customer_name: string | null;
    sale_status: string;
    utilities_ready: boolean;
  }>(
    `SELECT u.id, u.unit_number, u.sale_status, u.utilities_ready,
            b.id AS booking_id, a.display_name AS customer_name
       FROM unit u
       LEFT JOIN booking b ON b.unit_id = u.id AND b.status = 'active'
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE u.project_id = $1 AND b.id IS NOT NULL
      ORDER BY u.unit_number`,
    [projectId]
  );
  const out = [];
  for (const u of units.rows) {
    const ready = await unitReadiness(u.id);
    const snags = await listSnagsForUnit(u.id);
    out.push({ ...u, ...ready, snags });
  }
  return out;
}

export async function verifyComponent(unitId: string, component: string, evidenceNote: string) {
  if (!evidenceNote?.trim()) throw new Error("evidence_required");
  const exists = await db.query<{ code: string }>(`SELECT code FROM component_definition WHERE code = $1`, [component]);
  if (exists.rows.length === 0) throw new Error("unknown_component");
  await db.query(
    `INSERT INTO qa_evidence (unit_id, component_code, qa_verified, evidence_note, verified_at)
     VALUES ($1,$2,true,$3,now())
     ON CONFLICT (unit_id, component_code)
     DO UPDATE SET qa_verified = true, evidence_note = $3, verified_at = now()`,
    [unitId, component, evidenceNote.trim()]
  );
  return unitReadiness(unitId);
}

export async function closeSnag(id: string, beforeNote: string, afterNote: string) {
  if (!beforeNote?.trim() || !afterNote?.trim()) throw new Error("before_after_evidence_required");
  const s = await db.query<{ id: string }>(`SELECT id FROM snag WHERE id = $1`, [id]);
  if (s.rows.length === 0) throw new Error("not_found");
  await db.query(
    `UPDATE snag SET status = 'closed', before_note = $2, after_note = $3 WHERE id = $1`,
    [id, beforeNote.trim(), afterNote.trim()]
  );
  return db.query<SnagRow>(`SELECT * FROM snag WHERE id = $1`, [id]).then((r) => r.rows[0]);
}

async function policy(projectId: string) {
  const r = await db.query<{
    readiness_threshold: number;
    minor_snag_max: number;
  }>(
    `SELECT readiness_threshold::float8 AS readiness_threshold, minor_snag_max
       FROM handover_policy WHERE project_id = $1`,
    [projectId]
  );
  return r.rows[0] ?? { readiness_threshold: 80, minor_snag_max: 2 };
}

export async function handoverForBooking(bookingId: string) {
  const b = await db.query<{
    unit_id: string;
    project_id: string;
    unit_number: string;
    customer_name: string;
    utilities_ready: boolean;
    sale_status: string;
  }>(
    `SELECT b.unit_id, b.project_id, u.unit_number, u.utilities_ready, u.sale_status,
            a.display_name AS customer_name
       FROM booking b JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.id = $1`,
    [bookingId]
  );
  if (b.rows.length === 0) throw new Error("booking_not_found");
  const row = b.rows[0];
  const ready = await unitReadiness(row.unit_id);
  const snags = await snagCounts(row.unit_id);
  const pol = await policy(row.project_id);
  const finance = await bookingFinance(bookingId);
  const legal = await db.query<{ id: string }>(
    `SELECT id FROM generated_document WHERE booking_id = $1 AND status IN ('executed','archived') LIMIT 1`,
    [bookingId]
  );
  const reg = await db.query<{ status: string }>(
    `SELECT status FROM registration_case WHERE booking_id = $1`,
    [bookingId]
  );
  const ho = await db.query<{ status: string }>(
    `SELECT status FROM handover_record WHERE booking_id = $1`,
    [bookingId]
  );
  const registered =
    reg.rows[0]?.status === "completed" ||
    row.sale_status === "registered" ||
    row.sale_status === "handed_over";
  const evald = evaluateHandover({
    readiness_value: ready.value,
    readiness_threshold: pol.readiness_threshold,
    utilities_ready: row.utilities_ready,
    critical_snags: snags.critical,
    minor_snags: snags.minor,
    minor_snag_max: pol.minor_snag_max,
    qa_approved: ready.qa_approved,
    financial_cleared: finance.cleared,
    legal_executed: legal.rows.length > 0,
    registered,
  });
  const completed = ho.rows[0]?.status === "completed";
  return {
    booking_id: bookingId,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    customer_name: row.customer_name,
    readiness: ready,
    ...evald,
    lifecycle: completed ? "completed" : evald.lifecycle,
    eligible: completed ? false : evald.eligible,
  };
}

export async function projectHandover(projectId: string) {
  const bks = await db.query<{ id: string }>(
    `SELECT id FROM booking WHERE project_id = $1 AND status = 'active'`,
    [projectId]
  );
  const rows = [];
  for (const b of bks.rows) rows.push(await handoverForBooking(b.id));
  return rows.sort((a, b) => a.unit_number.localeCompare(b.unit_number));
}

export async function completeHandover(bookingId: string) {
  const view = await handoverForBooking(bookingId);
  if (view.lifecycle === "completed") return view;
  if (!view.eligible) throw new Error("handover_not_eligible");
  const b = await db.query<{ unit_id: string; project_id: string }>(
    `SELECT unit_id, project_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  await db.query(
    `INSERT INTO handover_record (id, booking_id, unit_id, project_id, status, completed_at)
     VALUES ($1,$2,$3,$4,'completed', now())`,
    [randomUUID(), bookingId, b.rows[0].unit_id, b.rows[0].project_id]
  );
  await db.query(`UPDATE unit SET sale_status = 'handed_over' WHERE id = $1`, [b.rows[0].unit_id]);
  await onHandoverCompleted(bookingId);
  return handoverForBooking(bookingId);
}
