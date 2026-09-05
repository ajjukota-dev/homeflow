import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appendEvent, withTx, actorFields, type DbLike } from "../events";
import { AppError, type Ctx } from "../authz/types";
import { requireRole, STAFF_ROLES } from "../authz/requireRole";
import { todayIst } from "../authz/clock";
import { pdf } from "../pdf";
import { files } from "../ports/files";
import { createAction } from "../actions/core";
import { moneyToIndianFigures } from "../documents/source";
import { loadCr, loadPolicy, listCrItems, loadQuotation, assertCrActor, type QuotationRow } from "./store";
import { lineTotal } from "./costing";
import { CUSTOMISATION_DESK_ROLES } from "./capture";

// 18 rule 5: quotation issue/accept/expire. The PDF is rendered directly via the pdf port (not
// through 22's doc_factory_template/clause machinery) — see migration 0037's header for why.

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function quotationHtml(cr: { code: string; title: string }, lines: QuotationRow["lines"], subtotal: number, tax: number, waiver: number, total: number, validUntil: string): string {
  const rows = lines.map((l) => `<tr><td>${l.description}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${moneyToIndianFigures(l.unit_price_inr)}</td><td style="text-align:right">${l.tax_pct}%</td><td style="text-align:right">${moneyToIndianFigures(l.line_total_inr)}</td></tr>`).join("");
  return `<html><body style="font-family:sans-serif">
    <h2>Quotation — ${cr.code}</h2><p>${cr.title}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
      <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Tax</th><th>Line total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right">Subtotal: ${moneyToIndianFigures(subtotal)}<br/>Tax: ${moneyToIndianFigures(tax)}${waiver ? `<br/>Waiver: -${moneyToIndianFigures(waiver)}` : ""}<br/><b>Total: ${moneyToIndianFigures(total)}</b></p>
    <p>Valid until ${validUntil}.</p>
  </body></html>`;
}

/** Rule 5: issue a quotation from the CR's costed items (re-issue supersedes any ISSUED one). */
export async function issueQuotation(crId: string, ctx: Ctx): Promise<QuotationRow> {
  requireRole(ctx, CUSTOMISATION_DESK_ROLES);
  const cr = await loadCr(crId);
  if (cr.status !== "AWAITING_CUSTOMER") throw new AppError("conflict", `change request is ${cr.status}, not AWAITING_CUSTOMER`);
  const items = await listCrItems(crId);
  if (items.length === 0) throw new AppError("validation", "no line items to quote");
  const policy = await loadPolicy(cr.project_id);

  const lines = items.map((it) => ({ item_id: it.id, description: it.description, qty: it.qty, unit_price_inr: it.unit_price_inr, tax_pct: it.tax_pct, line_total_inr: lineTotal(it) }));
  const subtotal = items.reduce((s, it) => s + it.qty * it.unit_price_inr, 0);
  const tax = lines.reduce((s, l) => s + l.line_total_inr, 0) - subtotal;
  const total = subtotal + tax;
  const validUntil = addDays(todayIst(), policy.quotation_validity_days);

  const html = quotationHtml(cr, lines, subtotal, tax, 0, total, validUntil);
  const pdfBuffer = await pdf.render(html);
  const id = "quo_" + randomUUID().slice(0, 8);
  const key = `project/${cr.project_id}/change_request/${crId}/quotation/${id}.pdf`;
  await files.putBuffer(key, pdfBuffer, "application/pdf");

  return withTx(undefined, async (tx) => {
    const prior = await tx.query<{ id: string }>(`SELECT id FROM quotation WHERE cr_id = $1 AND status = 'ISSUED'`, [crId]);
    const nextVersion = (await tx.query<{ n: number }>(`SELECT 1 + COALESCE(MAX(version),0)::int AS n FROM quotation WHERE cr_id = $1`, [crId])).rows[0]!.n;
    for (const p of prior.rows) await tx.query(`UPDATE quotation SET status = 'SUPERSEDED' WHERE id = $1`, [p.id]);
    await tx.query(
      `INSERT INTO quotation (id, cr_id, version, lines, subtotal_inr, tax_inr, waiver_inr, total_inr, valid_until, issued_by, status, pdf_file_key)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,0,$7,$8,$9,'ISSUED',$10)`,
      [id, crId, nextVersion, JSON.stringify(lines), subtotal, tax, total, validUntil, ctx.actor.user_id, key]
    );
    await tx.query(`UPDATE change_request SET quotation_id = $2, updated_at = now() WHERE id = $1`, [crId, id]);
    await appendEvent(tx, {
      type: "change_request.quotation_issued", entity_type: "quotation", entity_id: id, project_id: cr.project_id, booking_id: cr.booking_id,
      payload: { cr_code: cr.code, version: nextVersion, total_inr: total, valid_until: validUntil }, ...actorFields(ctx),
    });
    return loadQuotation(id, tx);
  });
}

/** Rule 5: acceptance (portal or a signed copy CRM records on the customer's behalf) moves the
 *  CR to AWAITING_PAYMENT. */
export async function acceptQuotation(quotationId: string, input: { accepted_via: "PORTAL" | "SIGNED_COPY" }, ctx: Ctx): Promise<QuotationRow> {
  const q = await loadQuotation(quotationId);
  if (q.status !== "ISSUED") throw new AppError("conflict", `quotation is ${q.status}, not ISSUED`);
  const cr = await loadCr(q.cr_id);
  await assertCrActor(cr, ctx, [...CUSTOMISATION_DESK_ROLES, "CRM"]); // rule 5: portal (customer) or CRM recording a signed copy on the customer's behalf
  if (ctx.actor.kind === "CUSTOMER" && input.accepted_via !== "PORTAL") throw new AppError("validation", "a customer accepts only via the portal channel", "accepted_via");

  const policy = await loadPolicy(cr.project_id);
  const gateAmount = Math.round(q.total_inr * (policy.payment_gate_pct / 100));

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE quotation SET status = 'ACCEPTED', customer_accepted_at = now(), accepted_via = $2 WHERE id = $1`, [quotationId, input.accepted_via]);
    await appendEvent(tx, { type: "change_request.quotation_accepted", entity_type: "quotation", entity_id: quotationId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { accepted_via: input.accepted_via, total_inr: q.total_inr }, ...actorFields(ctx) });

    let demandId: string | null = null;
    let paymentGate: "REQUIRED" | "WAIVED" = "REQUIRED";
    if (gateAmount > 0) {
      demandId = "dmd_" + randomUUID().slice(0, 8);
      const seq = (await tx.query<{ n: number }>(`SELECT 1 + COALESCE(MAX(sequence),0)::int AS n FROM demand WHERE booking_id = $1`, [cr.booking_id])).rows[0]!.n;
      await tx.query(
        `INSERT INTO demand (id, booking_id, project_id, milestone_key, milestone_label, sequence, amount, due_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'due')`,
        [demandId, cr.booking_id, cr.project_id, `CR:${cr.code}`, `Customisation — ${cr.title}`, seq, gateAmount, todayIst()]
      );
      await appendEvent(tx, { type: "demand.raised", entity_type: "demand", entity_id: demandId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { milestone_key: `CR:${cr.code}`, amount: gateAmount, source: "change_request" } });
    } else {
      paymentGate = "WAIVED"; // gate configured at 0% — nothing to collect
    }
    await tx.query(`UPDATE change_request SET status = 'AWAITING_PAYMENT', payment_gate = $2, payment_demand_id = $3, updated_at = now() WHERE id = $1`, [cr.id, paymentGate, demandId]);
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: cr.id, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: "AWAITING_CUSTOMER", to: "AWAITING_PAYMENT", payment_gate: paymentGate } });
  });
  return loadQuotation(quotationId);
}

/** Rule 5's expiry sweep — callable, not cron-wired (same gap already documented for 06/12/19/21). */
export async function sweepExpiredQuotations(asOf: string = todayIst()): Promise<{ expired: number }> {
  const rows = await db.query<{ id: string; cr_id: string; project_id: string; booking_id: string; code: string }>(
    `SELECT q.id, q.cr_id, c.project_id, c.booking_id, c.code FROM quotation q JOIN change_request c ON c.id = q.cr_id
      WHERE q.status = 'ISSUED' AND q.valid_until < $1 AND c.status = 'AWAITING_CUSTOMER'`,
    [asOf]
  );
  for (const r of rows.rows) {
    await withTx(undefined, async (tx) => {
      await tx.query(`UPDATE quotation SET status = 'EXPIRED' WHERE id = $1`, [r.id]);
      const actionId = await createAction({
        type: "exec_simple", title: `Quotation expired for ${r.code} — re-issue or follow up`, project_id: r.project_id,
        source_module: "change_requests", source_entity_type: "quotation", source_entity_id: r.id, booking_id: r.booking_id, owner_role: "CRM", origin: "AUTO",
      }, tx);
      await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: r.cr_id, project_id: r.project_id, booking_id: r.booking_id, payload: { quotation_expired: r.id, follow_up_action_id: actionId } });
    });
  }
  return { expired: rows.rows.length };
}
