import type { Express } from "express";
import {
  getOverview,
  getJourney,
  getPayments,
  getDocuments,
  uploadCustomerDocument,
  getRegistrationArea,
  confirmRegistrationAvailability,
  getHandoverArea,
  confirmHandoverAppointment,
  rescheduleHandoverAppointment,
  getRequests,
  raiseCustomerRequest,
  acceptCustomerQuotation,
  getCommitments,
  getPassport,
  getMyHome,
  getUpdates,
  submitCheckIn,
  listDraftUpdates,
  publishUpdate,
} from "./portal/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

// 26-customer-portal.md's API list, verbatim — all under `/portal`, session-scoped (every
// function resolves "my booking" itself via ctx.actor, never a path param, per rule 1).

export function registerPortalRoutes(app: Express) {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/portal/me", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getOverview(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/bookings/:id/overview", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getOverview(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/journey", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getJourney(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/my-home", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getMyHome(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/payments", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getPayments(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/documents", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getDocuments(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/documents/:id/upload", async (req: AuthedRequest, res) => {
    try { res.json({ data: await uploadCustomerDocument(req.params.id, req.body.content_type, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/registration", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getRegistrationArea(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/registration/confirm", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmRegistrationAvailability(req.body.dates, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/handover", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getHandoverArea(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/handover/appointment/confirm", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmHandoverAppointment(req.body.slot, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/handover/appointment/reschedule", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rescheduleHandoverAppointment(req.body.slot, req.body.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/requests", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getRequests(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/requests", async (req: AuthedRequest, res) => {
    try { res.json({ data: await raiseCustomerRequest(req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/requests/quotations/:id/accept", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acceptCustomerQuotation(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/commitments", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCommitments(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/passport", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getPassport(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portal/updates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUpdates(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/portal/check-ins/:id", async (req: AuthedRequest, res) => {
    try {
      await submitCheckIn(req.params.id, { score: req.body.score, comment: req.body.comment }, ctx(req));
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });

  // CRM side
  app.get("/api/bookings/:id/customer-updates", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listDraftUpdates(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/customer-updates/:id/publish", async (req: AuthedRequest, res) => {
    try {
      await publishUpdate(req.params.id, { title: req.body.title, body: req.body.body }, ctx(req));
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });
}
