import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { listTemplates, createTemplate, updateTemplate, submitTemplateForReview, approveTemplate, retireTemplate, listMergeFields, putMergeFields } from "./documents/templates";
import { listClauses, createClause, updateClause, approveClause, listSelectionRules, putSelectionRules } from "./documents/clauses";
import { computeReadiness } from "./documents/readiness";
import { generateDocument } from "./documents/generate";
import { loadDocument, listDocuments, listBookingsForDocuments, withLabels } from "./documents/store";
import { submitForReview, decideStage, sendForCustomerReview, approveForExecution, recordExecution, archiveDocument, listApprovals } from "./documents/workflow";
import { listDeviations, raiseDeviation, approveDeviation, rejectDeviation } from "./documents/deviations";
import { listChecklist, requestDocument, uploadDocument, validateDocument, acceptDocument, rejectDocument, markNotApplicable, listChecklistRules, putChecklistRules } from "./documents/checklist";

// 22-document-factory.md §API.
export function registerDocumentRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  // --- Templates & clauses (Studio) ---
  app.get("/api/document-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listTemplates({ family_code: req.query.family_code as string | undefined, project_id: req.query.project_id as string | undefined }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/document-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createTemplate(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/document-templates/:id/versions/:v", async (req: AuthedRequest, res) => {
    try { res.json({ data: await updateTemplate(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/document-templates/:id/submit-review", async (req: AuthedRequest, res) => {
    try { res.json({ data: await submitTemplateForReview(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/document-templates/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveTemplate(req.params.id, req.body?.change_note ?? null, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/document-templates/:id/retire", async (req: AuthedRequest, res) => {
    try { res.json({ data: await retireTemplate(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/document-templates/:id/clause-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putSelectionRules(req.params.id, req.body?.rules ?? req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/document-templates/:id/clause-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listSelectionRules(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/clauses", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listClauses(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/clauses", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createClause(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/clauses/:id/versions/:v", async (req: AuthedRequest, res) => {
    try { res.json({ data: await updateClause(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/clauses/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveClause(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/merge-fields", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listMergeFields(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/merge-fields", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putMergeFields(req.body?.fields ?? req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  // --- Documents ---
  app.get("/api/documents", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await listDocuments(
          { project_id: req.query.project_id as string | undefined, booking_id: req.query.booking_id as string | undefined, status: req.query.status as string | undefined, family_code: req.query.family_code as string | undefined },
          ctx(req)
        ),
      });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/documents/bookings", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listBookingsForDocuments(req.query.project_id as string | undefined, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/bookings/:id/documents/readiness", async (req: AuthedRequest, res) => {
    try { res.json({ data: await computeReadiness(req.params.id, req.query.family as string) }); } catch (e) { failHttp(res, e); }
  });
  // Same URL as routes-lifecycle.ts's legacy legal-docs.ts::generateDocument (spec 22's own API
  // list names this exact path). The two systems partition by request shape, not path: the legacy
  // caller (api-lifecycle.ts) always sends `document_family`, never `family` — so an absent
  // `family` falls through via next() to the legacy handler, which server.ts registers after this one.
  app.post("/api/bookings/:id/documents/generate", async (req: AuthedRequest, res, next) => {
    if (!req.body?.family) return next();
    try {
      res.json({ data: await withLabels(await generateDocument(req.params.id, req.body?.family, { template_id: req.body?.template_version_id, clause_params: req.body?.clause_params }, ctx(req))) });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/documents/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await loadDocument(req.params.id)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/submit-review", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await submitForReview(req.params.id, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  // Same collision as generate above: legacy legal-docs.ts::approveDocument also answers
  // POST /api/documents/:id/approve, with no `stage` in its body — that's the fall-through signal.
  app.post("/api/documents/:id/approve", async (req: AuthedRequest, res, next) => {
    if (!req.body?.stage) return next();
    try { res.json({ data: await withLabels(await decideStage(req.params.id, req.body?.stage, "APPROVED", req.body?.note ?? null, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await decideStage(req.params.id, req.body?.stage, "REJECTED", req.body?.note ?? null, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/send-customer-review", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await sendForCustomerReview(req.params.id, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/approve-for-execution", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await approveForExecution(req.params.id, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/record-execution", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await recordExecution(req.params.id, req.body ?? {}, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/archive", async (req: AuthedRequest, res) => {
    try { res.json({ data: await withLabels(await archiveDocument(req.params.id, ctx(req))) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/documents/:id/approvals", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listApprovals(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/documents/:id/deviations", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listDeviations(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/documents/:id/deviations", async (req: AuthedRequest, res) => {
    try { res.json({ data: await raiseDeviation(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/deviations/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveDeviation(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/deviations/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectDeviation(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  // --- Customer document checklist ---
  app.get("/api/bookings/:id/customer-documents", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listChecklist(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/request", async (req: AuthedRequest, res) => {
    try { res.json({ data: await requestDocument(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/upload", async (req: AuthedRequest, res) => {
    try { res.json({ data: await uploadDocument(req.params.id, { content_type: req.body?.content_type }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/validate", async (req: AuthedRequest, res) => {
    try { res.json({ data: await validateDocument(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/accept", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acceptDocument(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectDocument(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/customer-documents/:id/mark-na", async (req: AuthedRequest, res) => {
    try { res.json({ data: await markNotApplicable(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/document-checklist-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listChecklistRules(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/document-checklist-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putChecklistRules(req.body?.rules ?? req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
