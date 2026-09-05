import type { Express } from "express";
import { listEscalations, getEscalation, acknowledgeEscalation, startEscalation, resolveEscalation, closeEscalation, reopenEscalation, scanEscalations } from "./escalations/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";

// 12-escalations-notifications.md's API list — Studio tabs (escalation-rules/ladders/
// materiality-thresholds CRUD) deferred, same reasoning as every other spec's Studio UI so far.

export function registerEscalationRoutes(app: Express) {
  app.get("/api/escalations", async (req: AuthedRequest, res) => {
    try {
      const data = await listEscalations(
        {
          tier: req.query.tier as string | undefined,
          status: req.query.status as string | undefined,
          category: req.query.category as string | undefined,
          project_id: req.query.project_id as string | undefined,
        },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/escalations/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getEscalation(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/escalations/:id/acknowledge", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acknowledgeEscalation(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/escalations/:id/start", async (req: AuthedRequest, res) => {
    try { res.json({ data: await startEscalation(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/escalations/:id/resolve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await resolveEscalation(req.params.id, req.body?.resolution_notes, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/escalations/:id/close", async (req: AuthedRequest, res) => {
    try { res.json({ data: await closeEscalation(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/escalations/:id/reopen", async (req: AuthedRequest, res) => {
    try { res.json({ data: await reopenEscalation(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  // Not a real cron (no scheduler exists anywhere in this codebase) — a manually-triggerable
  // scan for demo/ops use, same shape the spec's own "job; also cron" phrasing anticipates.
  app.post("/api/escalations/scan", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES); // any staff role — no per-module gate exists for a system-wide sweep
      res.json({ data: await scanEscalations() });
    } catch (e) { failHttp(res, e); }
  });
}
