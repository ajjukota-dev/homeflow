import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { getUnitChangeability, getProjectChangeability, evaluateDryRun, listRules, putRules, publishRules, grantException, revokeException } from "./changeability/core";

// 08-changeability-engine.md's API list. The pre-08 gate read model on GET /api/units/:id
// (handlers.ts) stays; both derive from the same rules.

export function registerChangeabilityRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });
  const scope = (req: AuthedRequest) => ({ project_id: (req.query.project_id as string | undefined) ?? (req.body?.project_id as string | undefined) ?? null });

  app.get("/api/units/:id/changeability", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUnitChangeability(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/projects/:id/changeability", async (req: AuthedRequest, res) => {
    const q = req.query as Record<string, string | undefined>;
    try { res.json({ data: await getProjectChangeability(req.params.id, { node_id: q.node_id, category: q.category, state: q.state }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/changeability/evaluate", async (req: AuthedRequest, res) => {
    if (!req.body?.unit_id) return res.status(400).json({ errors: [{ code: "missing_fields", field: "unit_id" }] });
    try { res.json({ data: await evaluateDryRun(req.body.unit_id, req.body.overrides ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/change-gate-rules", async (req: AuthedRequest, res) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      res.json({ data: await listRules({ project_id: q.project_id === undefined ? undefined : q.project_id === "standard" ? null : q.project_id, status: q.status }, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });
  app.put("/api/change-gate-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putRules(scope(req), req.body?.rules, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/change-gate-rules/publish", async (req: AuthedRequest, res) => {
    try { res.json({ data: await publishRules(scope(req), req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/units/:id/gate-exceptions", async (req: AuthedRequest, res) => {
    try { res.json({ data: await grantException(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/gate-exceptions/:id/revoke", async (req: AuthedRequest, res) => {
    try { res.json({ data: await revokeException(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
