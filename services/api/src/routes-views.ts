import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { getUnit360, getUnitActivity } from "./views/unit-360";
import { getCustomer360, getCustomerDocuments, getCustomerActivity } from "./views/customer-360";
import { getBooking360, getBookingActivity } from "./views/booking-360";
import { getProjectHeader } from "./views/project-header";
import { getMyContext, setMyContext } from "./views/context";

// 28-360-views.md API.
export function registerViewRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/units/:id/360", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUnit360(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/units/:id/activity", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUnitActivity(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customers/:id/360", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCustomer360(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customers/:id/documents", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCustomerDocuments(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customers/:id/activity", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCustomerActivity(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/bookings/:id/360", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getBooking360(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/bookings/:id/activity", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getBookingActivity(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/projects/:id/header", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getProjectHeader(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/me/context", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getMyContext(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/me/context", async (req: AuthedRequest, res) => {
    try { res.json({ data: await setMyContext(ctx(req), req.body ?? {}) }); } catch (e) { failHttp(res, e); }
  });
}
