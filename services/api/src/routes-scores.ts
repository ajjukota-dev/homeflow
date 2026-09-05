import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { authorize } from "./authz/authorize";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";
import { computeUnitReadiness, explainUnitReadiness } from "./scores/unit-readiness";
import { computeBookingReadiness, explainBookingReadiness } from "./scores/booking-readiness";
import { computeHandoverReadiness, explainHandoverReadiness } from "./scores/handover-readiness";

// 14-readiness-scores.md's API list — the project readiness heatmap (already served by qa.ts's
// `projectReadiness`), score-weight Studio CRUD, and CUSTOMER_HEALTH/FINANCIAL_HEALTH (19/31 own
// those computations, this spec only defines the contract they reuse) are deferred, same
// reasoning as every other spec's Studio UI so far. Booking/handover readiness have no dedicated
// permission_matrix module (only `unit_readiness`/`customer_unit_readiness`/`handovers` exist,
// none of them the right shape for a cross-module composite) — same gap class R0.6 already found
// for other pre-matrix routes; gated on any staff role instead of inventing a module.

export function registerScoreRoutes(app: Express) {
  app.get("/api/units/:id/scores/unit-readiness", async (req: AuthedRequest, res) => {
    try {
      await authorize({ actor: req.actor! }, "unit_readiness", "READ");
      res.json({ data: await computeUnitReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/booking-readiness", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES);
      res.json({ data: await computeBookingReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/handover-readiness", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES);
      res.json({ data: await computeHandoverReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/units/:id/scores/unit-readiness/explain", async (req: AuthedRequest, res) => {
    try {
      await authorize({ actor: req.actor! }, "unit_readiness", "READ");
      res.json({ data: await explainUnitReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/booking-readiness/explain", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES);
      res.json({ data: await explainBookingReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/handover-readiness/explain", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES);
      res.json({ data: await explainHandoverReadiness(req.params.id) });
    } catch (e) { failHttp(res, e); }
  });
}
