import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import {
  getHandoverCase, listHandoverPipeline, proposeAppointment, confirmAppointment, rescheduleAppointment,
  updateChecklist, overrideGate, completeCase, closeCase, evaluateAndLog,
} from "./handover/core";
import { listGateConfig, putGateConfig } from "./handover/policy";

// 16-handover-gates.md §API. Case identity keyed by booking_id throughout, same convention 23's
// routes-registration.ts uses (spec's own `:id` is the booking id — `GET /bookings/:id/handover`).
export function registerHandoverRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/bookings/:id/handover", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getHandoverCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/evaluate", async (req: AuthedRequest, res) => {
    try { res.json({ data: await evaluateAndLog(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/override", async (req: AuthedRequest, res) => {
    try { res.json({ data: await overrideGate(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/appointment/propose", async (req: AuthedRequest, res) => {
    try { res.json({ data: await proposeAppointment(req.params.id, req.body?.slots ?? [], ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/appointment/confirm", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmAppointment(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/appointment/reschedule", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rescheduleAppointment(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/handover/:id/checklist", async (req: AuthedRequest, res) => {
    try { res.json({ data: await updateChecklist(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/complete", async (req: AuthedRequest, res) => {
    try { res.json({ data: await completeCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/handover/:id/close", async (req: AuthedRequest, res) => {
    try { res.json({ data: await closeCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/projects/:id/handover-pipeline", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listHandoverPipeline(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/handover-gate-config", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listGateConfig(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/handover-gate-config", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putGateConfig(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
