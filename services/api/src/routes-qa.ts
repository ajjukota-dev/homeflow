import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { listTemplates, upsertTemplate } from "./qa/templates";
import {
  startInspection, getInspection, setInspectionItems, addInspectionEvidence, verifyInspectionEvidence, completeInspection,
  listInspectionsForUnit, listQaExceptions,
} from "./qa/inspections";
import { listDependencies, createDependency, patchDependency } from "./qa/dependencies";
import {
  listSnags, getSnag, createSnag, assignSnag, startSnag, readySnag, verifySnag, customerVerifySnag, reopenSnag, patchSnag,
  snagAnalytics, listContractors, createContractor,
} from "./qa/snags";

// 15-qa-evidence-snags.md's API list. The pre-15 QA routes in routes-lifecycle.ts
// (POST /units/:id/qa/:component/verify, POST /snags/:id/close) stay registered for the existing
// console; both paths converge on the same tables.

export function registerQaRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/qa/checklist-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listTemplates(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/qa/checklist-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await upsertTemplate(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/units/:id/inspections", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listInspectionsForUnit(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/units/:id/inspections", async (req: AuthedRequest, res) => {
    const { component_code, kind } = req.body ?? {};
    if (!component_code || !kind) return res.status(400).json({ errors: [{ code: "missing_fields" }] });
    try { res.json({ data: await startInspection(req.params.id, { component_code, kind }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/inspections/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getInspection(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/inspections/:id/items", async (req: AuthedRequest, res) => {
    try { res.json({ data: await setInspectionItems(req.params.id, req.body?.items, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/inspections/:id/evidence", async (req: AuthedRequest, res) => {
    try { res.json({ data: await addInspectionEvidence(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/inspections/:id/evidence/:eid/verify", async (req: AuthedRequest, res) => {
    try { await verifyInspectionEvidence(req.params.eid, "VERIFIED", req.body?.note, ctx(req)); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/inspections/:id/evidence/:eid/reject", async (req: AuthedRequest, res) => {
    try { await verifyInspectionEvidence(req.params.eid, "REJECTED", req.body?.note, ctx(req)); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/inspections/:id/complete", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await completeInspection(req.params.id, ctx(req)) });
    } catch (e) {
      const err = e as Error & { blockers?: string[]; code?: string };
      if (err.blockers) return res.status(400).json({ errors: [{ code: "incomplete", message: err.message, blockers: err.blockers }] });
      failHttp(res, e);
    }
  });
  app.get("/api/projects/:id/qa/exceptions", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listQaExceptions(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/dependencies", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listDependencies(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/projects/:id/dependencies", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createDependency(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.patch("/api/dependencies/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await patchDependency(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/contractors", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listContractors(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/contractors", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createContractor(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/snags/analytics", async (req: AuthedRequest, res) => {
    const projectId = req.query.project_id as string | undefined;
    if (!projectId) return res.status(400).json({ errors: [{ code: "missing_fields", field: "project_id" }] });
    try { res.json({ data: await snagAnalytics(projectId, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/snags", async (req: AuthedRequest, res) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      res.json({ data: await listSnags({ project_id: q.project_id, unit_id: q.unit_id, status: q.status, severity: q.severity, contractor_id: q.contractor_id }, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createSnag(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/snags/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getSnag(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.patch("/api/snags/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await patchSnag(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags/:id/assign", async (req: AuthedRequest, res) => {
    try { res.json({ data: await assignSnag(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags/:id/start", async (req: AuthedRequest, res) => {
    try { res.json({ data: await startSnag(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags/:id/ready", async (req: AuthedRequest, res) => {
    try { res.json({ data: await readySnag(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags/:id/verify", async (req: AuthedRequest, res) => {
    try { res.json({ data: await verifySnag(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/snags/:id/customer-verify", async (req: AuthedRequest, res) => {
    try { res.json({ data: await customerVerifySnag(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  // POST /api/snags/:id/close lives in routes-lifecycle.ts (shared with the pre-15 note-based close).
  app.post("/api/snags/:id/reopen", async (req: AuthedRequest, res) => {
    try { res.json({ data: await reopenSnag(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
