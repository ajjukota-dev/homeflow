import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import {
  getRegistrationCase, listRegistrationPipeline, confirmAvailability, bookSlot, rescheduleSlot,
  updateDayOfChecklist, recordExecution, completeCase,
} from "./registration/core";
import { listChecklistTemplates, putChecklistTemplate } from "./registration/policy";

// 23-registration.md §API. Case identity is keyed by booking_id throughout (same as 19's
// clearance/tds routes) rather than the case's own row id — spec's `:id` in `/registration/:id/...`
// is the booking id, matching `GET /bookings/:id/registration`'s own naming.
export function registerRegistrationRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/bookings/:id/registration", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getRegistrationCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/registration/:id/confirm-availability", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmAvailability(req.params.id, req.body?.dates ?? [], ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/registration/:id/book-slot", async (req: AuthedRequest, res) => {
    try { res.json({ data: await bookSlot(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/registration/:id/reschedule", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rescheduleSlot(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/registration/:id/day-of-checklist", async (req: AuthedRequest, res) => {
    try { res.json({ data: await updateDayOfChecklist(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/registration/:id/execute", async (req: AuthedRequest, res) => {
    try { res.json({ data: await recordExecution(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/registration/:id/complete", async (req: AuthedRequest, res) => {
    try { res.json({ data: await completeCase(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/projects/:id/registration-pipeline", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listRegistrationPipeline(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/registration-checklist-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listChecklistTemplates(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/registration-checklist-templates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putChecklistTemplate(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
