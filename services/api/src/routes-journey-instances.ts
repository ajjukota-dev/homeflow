import type { Express } from "express";
import {
  getJourneyForBooking,
  holdJourney,
  resumeJourney,
  closeJourney,
  reopenTaskInstance,
  completeTaskInstance,
} from "./journey/instances";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

/** Express adapter for journey instances (06-timeline-sla-engine.md). Handlers throw AppError
 *  only. `complete` is a stand-in for Universal Action's real close flow (10 not built yet) —
 *  not in 06's own API list, added so the lifecycle is actually reachable/testable end to end. */
export function registerJourneyInstanceRoutes(app: Express) {
  app.get("/api/bookings/:id/journey", async (req: AuthedRequest, res) => {
    try {
      const journey = await getJourneyForBooking(req.params.id, { actor: req.actor! });
      if (!journey) return res.status(404).json({ errors: [{ code: "not_found" }] });
      res.json({ data: journey });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journeys/:id/hold", async (req: AuthedRequest, res) => {
    try {
      await holdJourney(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journeys/:id/resume", async (req: AuthedRequest, res) => {
    try {
      await resumeJourney(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journeys/:id/close", async (req: AuthedRequest, res) => {
    try {
      await closeJourney(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/task-instances/:id/reopen", async (req: AuthedRequest, res) => {
    try {
      await reopenTaskInstance(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/task-instances/:id/complete", async (req: AuthedRequest, res) => {
    try {
      await completeTaskInstance(req.params.id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });
}
