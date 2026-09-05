import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { raiseChangeRequest, recordFeasibility, getChangeRequest, listChangeRequests, withdrawChangeRequest } from "./change-requests/capture";
import { putCrItems, setImpact, linkGateException } from "./change-requests/costing";
import { listApprovalRules, putApprovalRules, submitCrForApproval, decideCrApproval } from "./change-requests/approvals";
import { issueQuotation, acceptQuotation } from "./change-requests/quotation";
import { confirmPaymentGate, waivePayment, releaseChangeRequest } from "./change-requests/release";
import { closeExecutionAction, linkQaInspection, markQaVerified, customerAcceptCr, asBuiltClose } from "./change-requests/execution";
import { cancelChangeRequest } from "./change-requests/cancellation";
import { getCrEconomics } from "./change-requests/economics";
import { getCustomisationPolicy, putCustomisationPolicy } from "./change-requests/policy";

// 18-change-requests.md §API.
export function registerChangeRequestRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.post("/api/bookings/:id/change-requests", async (req: AuthedRequest, res) => {
    try { res.json({ data: await raiseChangeRequest({ ...(req.body ?? {}), booking_id: req.params.id }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listChangeRequests({ status: req.query.status as string, project_id: req.query.project_id as string, owner_user_id: req.query.owner as string, booking_id: req.query.booking_id as string }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/change-requests/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getChangeRequest(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-requests/:id/feasibility", async (req: AuthedRequest, res) => {
    try { res.json({ data: await recordFeasibility(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
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
