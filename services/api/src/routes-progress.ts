import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { updateProgress, getUnitProgress, getProjectProgress, getProgressHistory, previewBulkUpdate, applyBulkUpdate } from "./progress/core";

// 07-unit-progress-control.md's API list. The pre-07 `PUT /api/units/:id/progress` (body
// component_code/state_code) stays registered in server.ts for the existing console; both paths
// end in progress/core.ts's updateProgress. Studio (components / freshness thresholds) deferred.

export function registerProgressRoutes(app: Express): void {
  app.get("/api/projects/:id/progress", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getProjectProgress(req.params.id, req.query.node_id as string | undefined, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/units/:id/progress", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getUnitProgress(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/units/:id/progress/history", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getProgressHistory(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.put("/api/units/:id/progress/:component", async (req: AuthedRequest, res) => {
    if (!req.body?.state_code) return res.status(400).json({ errors: [{ code: "missing_fields", field: "state_code" }] });
    try {
      res.json({ data: await updateProgress(req.params.id, req.params.component, req.body, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/projects/:id/progress/bulk/preview", async (req: AuthedRequest, res) => {
    const { scope, component_code, new_state, reason } = req.body ?? {};
    if (!scope || !component_code || !new_state) return res.status(400).json({ errors: [{ code: "missing_fields" }] });
    try {
      res.json({ data: await previewBulkUpdate(req.params.id, { scope, component_code, new_state, reason }, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/progress/bulk/:id/apply", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await applyBulkUpdate(req.params.id, { exceptions: req.body?.exceptions }, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });
}
