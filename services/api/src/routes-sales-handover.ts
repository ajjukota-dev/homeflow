import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { getSalesHandover, submitHandover, acceptHandover, returnHandover, getHandoverMetrics, listReturnReasons, getHandoverQueue } from "./sales-handover/core";

// 17-sales-crm-handover.md's API list. `PUT /bookings/:id/sales-handover` (packet edit without
// submitting) and the Studio checklist-rules/return-reasons CRUD routes are deferred — same
// reasoning as every other spec's Studio UI so far (studio/registry.ts's 17.* entries stay
// built: false). `submit` doubles as "create the packet" since there's no separate draft-editing
// UI in this backend-only slice (see sales-handover/core.ts header).

export function registerSalesHandoverRoutes(app: Express): void {
  app.get("/api/bookings/:id/sales-handover", async (req: AuthedRequest, res) => {
    try {
      const h = await getSalesHandover(req.params.id);
      if (!h) return res.status(404).json({ errors: [{ code: "not_found" }] });
      res.json({ data: h });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/bookings/:id/sales-handover/submit", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await submitHandover(req.params.id, req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      const err = e as Error & { blockers?: string[] };
      if (err.blockers) return res.status(400).json({ errors: [{ code: "gate_blocked", blockers: err.blockers }] });
      failHttp(res, e);
    }
  });

  app.post("/api/bookings/:id/sales-handover/accept", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await acceptHandover(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/bookings/:id/sales-handover/return", async (req: AuthedRequest, res) => {
    const { reason_code, note } = req.body ?? {};
    if (!reason_code) return res.status(400).json({ errors: [{ code: "missing_reason_code" }] });
    try {
      res.json({ data: await returnHandover(req.params.id, reason_code, note ?? "", { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/crm/handover-queue", async (req: AuthedRequest, res) => {
    const projectId = req.query.project_id as string | undefined;
    if (!projectId) return res.status(400).json({ errors: [{ code: "missing_project_id" }] });
    try {
      res.json({ data: await getHandoverQueue(projectId, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/sales/handover-metrics", async (req: AuthedRequest, res) => {
    const { project_id, from, to } = req.query as Record<string, string | undefined>;
    if (!project_id || !from || !to) return res.status(400).json({ errors: [{ code: "missing_fields" }] });
    try {
      res.json({ data: await getHandoverMetrics(project_id, from, to, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/return-reasons", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listReturnReasons({ actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });
}
