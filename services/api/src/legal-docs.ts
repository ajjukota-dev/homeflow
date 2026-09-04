import { randomUUID } from "node:crypto";
import { db } from "./db";
import {
  autoValidate,
  freezeSnapshot,
  readinessCheck,
  renderDraft,
  type MergeField,
} from "./legal";
import { bookingFinance } from "./finance";
import { checksum, getDocument, liveSnapshot, source } from "./legal-docs-source";

// Legal Document Factory + registration (legal/spec.md, H4 / H7 / H8).

export async function generateDocument(bookingId: string, documentFamily = "AOS") {
  const row = await source(bookingId);
  const tpl = await db.query<{ id: string; body: string; mandatory_fields: MergeField[] | string }>(
    `SELECT id, body, mandatory_fields FROM document_template
      WHERE status = 'approved' AND document_family = $1
        AND (project_id = $2 OR project_id IS NULL)
      ORDER BY project_id NULLS LAST LIMIT 1`,
    [documentFamily, row.project_id]
  );
  if (tpl.rows.length === 0) throw new Error("no_valid_approved_template");
  const fields = (typeof tpl.rows[0].mandatory_fields === "string"
    ? JSON.parse(tpl.rows[0].mandatory_fields)
    : tpl.rows[0].mandatory_fields) as MergeField[];
  const live = liveSnapshot(row);
  const ready = readinessCheck(live, fields);
  if (!ready.ok) {
    const err = new Error("validation_failed") as Error & { errors: typeof ready.errors };
    err.errors = ready.errors;
    throw err;
  }
  const snapshot = freezeSnapshot(live);
  const rendered = renderDraft(tpl.rows[0].body, snapshot);
  const valid = autoValidate({
    body: rendered.body,
    snapshot,
    consideration: row.total_consideration,
  });
  if (!valid.ok) {
    const err = new Error("validation_failed") as Error & { errors: typeof valid.errors };
    err.errors = valid.errors;
    throw err;
  }
  const ver = await db.query<{ n: number }>(
    `SELECT COALESCE(MAX(version),0)::int AS n FROM generated_document
      WHERE booking_id = $1 AND document_family = $2`,
    [bookingId, documentFamily]
  );
  const version = Number(ver.rows[0].n) + 1;
  const id = randomUUID();
  await db.query(
    `INSERT INTO generated_document
      (id, template_id, booking_id, project_id, unit_id, document_family, status, version, snapshot, body_rendered)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8::jsonb,$9)`,
    [
      id,
      tpl.rows[0].id,
      bookingId,
      row.project_id,
      row.unit_id,
      documentFamily,
      version,
      JSON.stringify(snapshot),
      rendered.body,
    ]
  );
  return getDocument(id);
}

export async function approveDocument(id: string) {
  const doc = await getDocument(id);
  if (!doc) throw new Error("not_found");
  if (doc.status !== "draft") throw new Error("not_draft");
  await db.query(`UPDATE generated_document SET status = 'legal_approved' WHERE id = $1`, [id]);
  return getDocument(id);
}

export async function executeDocument(id: string) {
  const doc = await getDocument(id);
  if (!doc) throw new Error("not_found");
  if (doc.status !== "legal_approved") throw new Error("not_approved");
  const sum = checksum(String(doc.body_rendered));
  await db.query(`UPDATE generated_document SET status = 'executed', checksum = $2 WHERE id = $1`, [id, sum]);
  return getDocument(id);
}

export async function completeRegistration(bookingId: string, sroReference: string) {
  const finance = await bookingFinance(bookingId);
  if (!finance.cleared) throw new Error(finance.reason ?? "financial_not_cleared");
  const executed = await db.query<{ id: string }>(
    `SELECT id FROM generated_document WHERE booking_id = $1 AND status IN ('executed','archived') LIMIT 1`,
    [bookingId]
  );
  if (executed.rows.length === 0) throw new Error("executed_agreement_missing");
  const row = await source(bookingId);
  await db.query(
    `INSERT INTO registration_case (id, booking_id, project_id, status, sro_reference, completed_at)
     VALUES ($1,$2,$3,'completed',$4, now())
     ON CONFLICT (booking_id) DO UPDATE SET status = 'completed', sro_reference = $4, completed_at = now()`,
    [randomUUID(), bookingId, row.project_id, sroReference]
  );
  await db.query(`UPDATE unit SET sale_status = 'registered' WHERE id = $1 AND sale_status <> 'handed_over'`, [
    row.unit_id,
  ]);
  await db.query(`UPDATE generated_document SET status = 'archived' WHERE id = $1`, [executed.rows[0].id]);
  return { booking_id: bookingId, status: "completed", sro_reference: sroReference };
}

export async function listLegalQueue(projectId: string) {
  const bookings = await db.query<{
    id: string;
    unit_id: string;
    unit_number: string;
    customer_name: string;
    sale_status: string;
  }>(
    `SELECT b.id, b.unit_id, u.unit_number, a.display_name AS customer_name, u.sale_status
       FROM booking b JOIN unit u ON u.id = b.unit_id
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE b.project_id = $1 AND b.status = 'active' ORDER BY u.unit_number`,
    [projectId]
  );
  const out = [];
  for (const b of bookings.rows) {
    const docs = await db.query<{
      id: string;
      document_family: string;
      status: string;
      version: number;
      snapshot: unknown;
    }>(
      `SELECT id, document_family, status, version, snapshot FROM generated_document
        WHERE booking_id = $1 ORDER BY version DESC`,
      [b.id]
    );
    const latest = docs.rows[0] ?? null;
    const reg = await db.query<{ id: string; status: string; sro_reference: string | null }>(
      `SELECT id, status, sro_reference FROM registration_case WHERE booking_id = $1`,
      [b.id]
    );
    const finance = await bookingFinance(b.id);
    out.push({
      booking_id: b.id,
      unit_id: b.unit_id,
      unit_number: b.unit_number,
      customer_name: b.customer_name,
      document: latest,
      versions: docs.rows,
      financial: { cleared: finance.cleared, reason: finance.reason, paid_pct: finance.paid_pct },
      registration: reg.rows[0] ?? { id: null, status: "not_ready", sro_reference: null },
    });
  }
  return out;
}
