import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { db } from "./db";
import { raiseChangeRequest, recordFeasibility, getChangeRequest, listChangeRequests, withdrawChangeRequest } from "./change-requests/capture";
import type { CrRow } from "./change-requests/store";
import { putCrItems, setImpact, linkGateException } from "./change-requests/costing";
import { listApprovalRules, putApprovalRules, submitCrForApproval, decideCrApproval, listCrApprovals } from "./change-requests/approvals";
import { issueQuotation, acceptQuotation } from "./change-requests/quotation";
import { confirmPaymentGate, waivePayment, releaseChangeRequest } from "./change-requests/release";
import { closeExecutionAction, linkQaInspection, markQaVerified, customerAcceptCr, asBuiltClose } from "./change-requests/execution";
import { cancelChangeRequest } from "./change-requests/cancellation";
import { getCrEconomics } from "./change-requests/economics";
import { getCustomisationPolicy, putCustomisationPolicy } from "./change-requests/policy";
import { listCrItems, loadQuotation } from "./change-requests/store";

// 18-change-requests.md §API.
//
// `CrRow` (change-requests/store.ts) carries only unit_id/booking_id — the desk UI must never
// show a raw id (this session's own established rule, after finding the same class of bug on
// specs 20/27 twice). Rather than touch store.ts's CR_SELECT (used by every rule 1-12 handler and
// their own tests — a JOIN there risks an ambiguous-column break on listChangeRequests's own
// project_id/status filters, since `booking` has both too), the friendly labels are attached here,
// at the route boundary, with zero risk to the already-tested domain layer.
async function withLabels<T extends CrRow>(rows: T[]): Promise<(T & { unit_number: string | null; booking_number: string | null })[]> {
  if (rows.length === 0) return [];
  const unitIds = [...new Set(rows.map((r) => r.unit_id))];
  const bookingIds = [...new Set(rows.map((r) => r.booking_id))];
  const units = await db.query<{ id: string; unit_number: string }>(`SELECT id, unit_number FROM unit WHERE id = ANY($1::text[])`, [unitIds]);
  const bookings = await db.query<{ id: string; booking_number: string }>(`SELECT id, booking_number FROM booking WHERE id = ANY($1::text[])`, [bookingIds]);
  const unitMap = new Map(units.rows.map((u) => [u.id, u.unit_number]));
  const bookingMap = new Map(bookings.rows.map((b) => [b.id, b.booking_number]));
  return rows.map((r) => ({ ...r, unit_number: unitMap.get(r.unit_id) ?? null, booking_number: bookingMap.get(r.booking_id) ?? null }));
}

export function registerChangeRequestRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.post("/api/bookings/:id/change-requests", async (req: AuthedRequest, res) => {
    try { res.json({ data: await raiseChangeRequest({ ...(req.body ?? {}), booking_id: req.params.id }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests", async (req: AuthedRequest, res) => {
    try {
      const rows = await listChangeRequests({ status: req.query.status as string, project_id: req.query.project_id as string, owner_user_id: req.query.owner as string, booking_id: req.query.booking_id as string }, ctx(req));
      res.json({ data: await withLabels(rows) });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests/:id", async (req: AuthedRequest, res) => {
    try {
      const cr = await getChangeRequest(req.params.id, ctx(req));
      res.json({ data: (await withLabels([cr]))[0] });
    } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/feasibility", async (req: AuthedRequest, res) => {
    try { res.json({ data: await recordFeasibility(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  // Read side of an already-built write API — putCrItems/issueQuotation existed with no way for
  // a UI to read either list back (same "write with no matching read" shape as spec 20's
  // listScenarios/forecast_assumption gap). Actor-gated via getChangeRequest's own assertCrActor.
  app.get("/api/change-requests/:id/items", async (req: AuthedRequest, res) => {
    try { await getChangeRequest(req.params.id, ctx(req)); res.json({ data: await listCrItems(req.params.id) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/quotations/:id", async (req: AuthedRequest, res) => {
    try {
      const q = await loadQuotation(req.params.id);
      await getChangeRequest(q.cr_id, ctx(req));
      res.json({ data: q });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests/:id/approvals", async (req: AuthedRequest, res) => {
    try { await getChangeRequest(req.params.id, ctx(req)); res.json({ data: await listCrApprovals(req.params.id) }); } catch (e) { failHttp(res, e); }
  });
  // Same read gap as items/quotation/approvals above: rule 7 creates cr_execution_action rows
  // with no way for a UI to list them back against the linked action's own title/status.
  app.get("/api/change-requests/:id/execution-actions", async (req: AuthedRequest, res) => {
    try {
      await getChangeRequest(req.params.id, ctx(req));
      // `action` has no created_at column (only due_at/closed_at) — ordered by action_id instead,
      // same "nothing better exists" call listActions itself makes with its own due_at NULLS LAST.
      const rows = await db.query<{ action_id: string; kind: string; title: string; status: string }>(
        `SELECT x.action_id, x.kind, a.title, a.status FROM cr_execution_action x JOIN action a ON a.id = x.action_id WHERE x.cr_id = $1 ORDER BY x.action_id`,
        [req.params.id]
      );
      res.json({ data: rows.rows });
    } catch (e) { failHttp(res, e); }
  });
  app.put("/api/change-requests/:id/items", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putCrItems(req.params.id, req.body?.items ?? req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/costing", async (req: AuthedRequest, res) => {
    try { await setImpact(req.params.id, req.body ?? {}, ctx(req)); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/link-exception", async (req: AuthedRequest, res) => {
    try { await linkGateException(req.params.id, req.body?.exception_id, ctx(req)); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/submit-approval", async (req: AuthedRequest, res) => {
    try { res.json({ data: await submitCrForApproval(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/issue-quotation", async (req: AuthedRequest, res) => {
    try { res.json({ data: await issueQuotation(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/quotations/:id/accept", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acceptQuotation(req.params.id, { accepted_via: req.body?.accepted_via ?? "PORTAL" }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/confirm-payment", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmPaymentGate(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/waive-payment", async (req: AuthedRequest, res) => {
    try { res.json({ data: await waivePayment(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/release", async (req: AuthedRequest, res) => {
    try { res.json({ data: await releaseChangeRequest(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  // Rule 8: closing each cr_execution_action moves the CR to READY_FOR_QA once all are closed.
  app.post("/api/change-request-executions/:actionId/close", async (req: AuthedRequest, res) => {
    try { res.json({ data: await closeExecutionAction(req.params.actionId, req.body?.note, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/link-qa-inspection", async (req: AuthedRequest, res) => {
    try { res.json({ data: await linkQaInspection(req.params.id, req.body?.qa_inspection_id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/qa-verify", async (req: AuthedRequest, res) => {
    try { res.json({ data: await markQaVerified(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/customer-accept", async (req: AuthedRequest, res) => {
    try { res.json({ data: await customerAcceptCr(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/as-built-close", async (req: AuthedRequest, res) => {
    try { res.json({ data: await asBuiltClose(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/withdraw", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withdrawChangeRequest(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/cancel", async (req: AuthedRequest, res) => {
    try { res.json({ data: await cancelChangeRequest(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests/:id/economics", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCrEconomics(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  // Approval action decision (mirrors 10's own /actions/:id/approve|reject shape, scoped to CR approvals)
  app.post("/api/change-request-approvals/:actionId/decide", async (req: AuthedRequest, res) => {
    try { res.json({ data: await decideCrApproval(req.params.actionId, req.body?.decision ?? "APPROVE", req.body?.note, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  // Studio
  app.get("/api/cr-approval-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listApprovalRules({ project_id: (req.query.project_id as string | undefined) ?? null }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/cr-approval-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putApprovalRules({ project_id: req.body?.project_id ?? null }, req.body?.rules ?? [], ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customisation-policy/:projectId", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCustomisationPolicy(req.params.projectId, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/customisation-policy/:projectId", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putCustomisationPolicy(req.params.projectId, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
