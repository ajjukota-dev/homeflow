import { randomUUID } from "node:crypto";
import { db } from "./db";
import { readinessScore } from "./readiness";
import { evaluateHandover } from "./handover";
import { bookingFinance } from "./finance";
import { onHandoverCompleted } from "./warranty";
import { componentsFor } from "./qa-evidence";
import { listSnagsForUnit, snagCounts, type SnagRow } from "./qa-snags";
import { appendEvent, withTx } from "./events";
import { authorize } from "./authz/authorize";
import type { Ctx } from "./authz/types";

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

export async function projectReadiness(projectId: string, ctx: Ctx) {
  await authorize(ctx, "unit_readiness", "READ");
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

/** Site/QA declares a component evidence-verified. Emits qa.inspection_passed (02 Appendix B). */
export async function verifyComponent(unitId: string, component: string, evidenceNote: string, ctx: Ctx) {
  await authorize(ctx, "unit_readiness", "WRITE");
  if (!evidenceNote?.trim()) throw new Error("evidence_required");
  const exists = await db.query<{ code: string }>(`SELECT code FROM component_definition WHERE code = $1`, [component]);
  if (exists.rows.length === 0) throw new Error("unknown_component");
  const u = await db.query<{ project_id: string }>(`SELECT project_id FROM unit WHERE id = $1`, [unitId]);
  await withTx(undefined, async (t) => {
    await t.query(
      `INSERT INTO qa_evidence (unit_id, component_code, qa_verified, evidence_note, verified_at)
       VALUES ($1,$2,true,$3,now())
       ON CONFLICT (unit_id, component_code)
       DO UPDATE SET qa_verified = true, evidence_note = $3, verified_at = now()`,
      [unitId, component, evidenceNote.trim()]
    );
    await appendEvent(t, {
      type: "qa.inspection_passed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: u.rows[0]?.project_id ?? null,
      unit_id: unitId,
      payload: { component, evidence_note: evidenceNote.trim() },
    });
  });
  return unitReadiness(unitId);
}

/** QA closes a snag with before/after evidence. Emits snag.closed (02 Appendix B). */
export async function closeSnag(id: string, beforeNote: string, afterNote: string, ctx: Ctx) {
  await authorize(ctx, "snagging", "WRITE");
  if (!beforeNote?.trim() || !afterNote?.trim()) throw new Error("before_after_evidence_required");
  const s = await db.query<{ id: string; unit_id: string; project_id: string }>(
    `SELECT id, unit_id, project_id FROM snag WHERE id = $1`,
    [id]
  );
  if (s.rows.length === 0) throw new Error("not_found");
  await withTx(undefined, async (t) => {
    await t.query(`UPDATE snag SET status = 'closed', before_note = $2, after_note = $3 WHERE id = $1`, [
      id,
      beforeNote.trim(),
      afterNote.trim(),
    ]);
    await appendEvent(t, {
      type: "snag.closed",
      entity_type: "snag",
      entity_id: id,
      project_id: s.rows[0].project_id,
      unit_id: s.rows[0].unit_id,
      payload: { before_note: beforeNote.trim(), after_note: afterNote.trim() },
    });
  });
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

// `ctx` optional: also called internally by tower-view.ts's controlTower, which is
// itself gated (escalations READ) before reaching here.
export async function projectHandover(projectId: string, ctx?: Ctx) {
  if (ctx) await authorize(ctx, "handovers", "READ");
  const bks = await db.query<{ id: string }>(
    `SELECT id FROM booking WHERE project_id = $1 AND status = 'active'`,
    [projectId]
  );
  const rows = [];
  for (const b of bks.rows) rows.push(await handoverForBooking(b.id));
  return rows.sort((a, b) => a.unit_number.localeCompare(b.unit_number));
}

/** QA/RM completes the gated handover. Emits handover.completed (02 Appendix B). */
export async function completeHandover(bookingId: string, ctx: Ctx) {
  await authorize(ctx, "handovers", "WRITE");
  const view = await handoverForBooking(bookingId);
  if (view.lifecycle === "completed") return view;
  if (!view.eligible) throw new Error("handover_not_eligible");
  const b = await db.query<{ unit_id: string; project_id: string }>(
    `SELECT unit_id, project_id FROM booking WHERE id = $1`,
    [bookingId]
  );
  const { unit_id: unitId, project_id: projectId } = b.rows[0];
  await withTx(undefined, async (t) => {
    await t.query(
      `INSERT INTO handover_record (id, booking_id, unit_id, project_id, status, completed_at)
       VALUES ($1,$2,$3,$4,'completed', now())`,
      [randomUUID(), bookingId, unitId, projectId]
    );
    await t.query(`UPDATE unit SET sale_status = 'handed_over' WHERE id = $1`, [unitId]);
    await appendEvent(t, {
      type: "handover.completed",
      entity_type: "booking",
      entity_id: bookingId,
      project_id: projectId,
      booking_id: bookingId,
      unit_id: unitId,
      payload: { readiness_value: view.readiness.value },
    });
    await appendEvent(t, {
      type: "unit.sale_status_changed",
      entity_type: "unit",
      entity_id: unitId,
      project_id: projectId,
      unit_id: unitId,
      payload: { from: "registered", to: "handed_over" },
    });
  });
  await onHandoverCompleted(bookingId);
  return handoverForBooking(bookingId);
}
