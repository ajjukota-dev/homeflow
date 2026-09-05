import { db } from "../db";
import { appendEvent, withTx, actorFields } from "../events";
import { requireRole } from "../authz/requireRole";
import { AppError, type Ctx } from "../authz/types";
import { DEMAND_SELECT, mapDemands } from "../demands";
import { requestWaiver } from "../waivers";
import { loadCr, type CrRow } from "./store";

// 18 rule 9's post-release half: withdraw (pre-release, customer-initiated) lives in capture.ts;
// this is cancellation after RELEASED — MANAGEMENT only, abortive cost recorded, execution
// actions reversed, and any amount already paid is raised as a 19 waiver/adjustment.
//
// `requestWaiver` calls `approvals/matrix.ts::requiredApprovers("WAIVER", ...)` and fails closed
// by design when no WAIVER band is configured (25's own build note: ships with zero seeded
// rows) — the same gap 19's own waiver flow already lives with. Cancellation itself still
// succeeds when that happens; the refund is flagged as needing a manual waiver instead of
// silently swallowed or force-created against an unconfigured matrix.
const CANCEL_ROLES = ["MANAGEMENT", "SUPER_ADMIN"];
const POST_RELEASE: string[] = ["IN_PROGRESS", "READY_FOR_QA", "QA_VERIFIED", "CUSTOMER_ACCEPTED"];

export async function cancelChangeRequest(crId: string, input: { reason: string; abortive_cost_inr: number }, ctx: Ctx): Promise<CrRow & { refund_raised: boolean }> {
  requireRole(ctx, CANCEL_ROLES);
  const cr = await loadCr(crId);
  if (!POST_RELEASE.includes(cr.status)) throw new AppError("conflict", `${cr.status} is not a released, in-flight state — use withdraw before release`);
  if (!input.reason?.trim()) throw new AppError("validation", "reason is required", "reason");
  if (!Number.isFinite(input.abortive_cost_inr) || input.abortive_cost_inr < 0) throw new AppError("validation", "abortive_cost_inr must be >= 0", "abortive_cost_inr");

  await withTx(undefined, async (tx) => {
    await tx.query(`UPDATE action a SET status = 'Cancelled' FROM cr_execution_action x WHERE x.action_id = a.id AND x.cr_id = $1 AND a.status NOT IN ('Closed','Cancelled')`, [crId]);
    await tx.query(`UPDATE change_request_item SET status = 'REVERSED' WHERE cr_id = $1 AND status IN ('PROPOSED','APPROVED','EXECUTED')`, [crId]);
    await tx.query(`UPDATE change_request SET status = 'CANCELLED', cancel_reason = $2, abortive_cost_inr = $3, updated_at = now() WHERE id = $1`, [crId, input.reason.trim(), input.abortive_cost_inr]);
    await appendEvent(tx, { type: "change_request.cancelled", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { reason: input.reason.trim(), abortive_cost_inr: input.abortive_cost_inr, from_status: cr.status }, ...actorFields(ctx) });
    await appendEvent(tx, { type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id, payload: { from: cr.status, to: "CANCELLED" } });
  });

  let refundRaised = false;
  if (cr.payment_demand_id) {
    const d = (await mapDemands(`${DEMAND_SELECT} WHERE d.id = $1`, [cr.payment_demand_id]))[0];
    const paid = d ? d.amount - d.remaining : 0;
    if (paid > 0) {
      try {
        await requestWaiver({ booking_id: cr.booking_id, demand_id: cr.payment_demand_id, kind: "OTHER_CHARGE", amount: paid, reason: `Refund — ${cr.code} cancelled: ${input.reason.trim()}` }, ctx);
        refundRaised = true;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        // No WAIVER approval band configured (25's own documented gap) — flagged, not forced.
        await appendEvent(db, {
          type: "change_request.status_changed", entity_type: "change_request", entity_id: crId, project_id: cr.project_id, booking_id: cr.booking_id,
          payload: { refund_waiver_failed: e.message, amount_inr: paid },
        });
      }
    }
  }
  return { ...(await loadCr(crId)), refund_raised: refundRaised };
}
