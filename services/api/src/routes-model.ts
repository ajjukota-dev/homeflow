import type { Express } from "express";
import { getProjectMaster, updateProject } from "./model/projects";
import { createHierarchyNode, listHierarchy } from "./model/hierarchy";
import { bulkCreateUnits, listUnitsForProject } from "./model/units";
import { listApplicants, setApplicants } from "./model/applicants";
import { mergePreview, mergeCustomer, updateCustomerResidency } from "./model/customers";
import { confirmBooking, cancelBooking, transferBooking } from "./model/bookings";
import type { AuthedRequest } from "./auth/middleware";
import { AppError } from "./authz/types";
import { failHttp } from "./authz/httpError";

// ValidationError (model/derive.ts) isn't an AppError instance but shares its
// {code, message, field} shape — preserved here alongside AppError's forbidden/
// not_found mapping (authorize()/requireRole() now throw from inside these handlers).
function fail(res: import("express").Response, e: unknown) {
  if (e instanceof AppError) return failHttp(res, e);
  const err = e as Error & { code?: string; field?: string };
  if (err.code === "validation") {
    return res.status(400).json({ errors: [{ code: "validation", message: err.message, field: err.field }] });
  }
  res.status(400).json({ errors: [{ code: "bad_request", message: String(err.message ?? e) }] });
}

/** Express adapter for the 04 canonical-model routes (projects master, hierarchy, bulk
 *  units, applicants, customer merge/residency, booking lifecycle). Handlers stay Express-free. */
export function registerModelRoutes(app: Express) {
  // --- Project master + hierarchy (04 §Screens "Projects") ---
  app.get("/api/projects/:id/master", async (req: AuthedRequest, res) => {
    try {
      const p = await getProjectMaster(req.params.id, { actor: req.actor! });
      if (!p) return res.status(404).json({ errors: [{ code: "not_found" }] });
      res.json({ data: p });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/api/projects/:id", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await updateProject(req.params.id, req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/projects/:id/hierarchy", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listHierarchy(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/hierarchy", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await createHierarchyNode(req.params.id, req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Units (04 §Screens "Units"): admin projection + bulk range create ---
  app.get("/api/projects/:id/units", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listUnitsForProject(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/units/bulk", async (req: AuthedRequest, res) => {
    try {
      const ids = await bulkCreateUnits(req.params.id, req.body ?? {}, { actor: req.actor! });
      res.json({ data: { unit_ids: ids, count: ids.length } });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Booking applicants (04 rule 4) ---
  app.get("/api/bookings/:id/applicants", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listApplicants(req.params.id, undefined, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.put("/api/bookings/:id/applicants", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await setApplicants(req.params.id, req.body?.applicants ?? [], { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Booking lifecycle: confirm / cancel / transfer (04 rule 3) ---
  app.post("/api/bookings/:id/confirm", async (req: AuthedRequest, res) => {
    try {
      await confirmBooking(req.params.id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/bookings/:id/cancel", async (req: AuthedRequest, res) => {
    try {
      await cancelBooking(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/bookings/:id/transfer", async (req: AuthedRequest, res) => {
    try {
      const successorId = await transferBooking(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { successor_booking_id: successorId } });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Customer merge + residency (04 rule 5/6, §Screens "Customers") ---
  app.get("/api/customers/:id/merge-preview", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await mergePreview(req.params.id, req.query.into as string, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/customers/:id/merge", async (req: AuthedRequest, res) => {
    try {
      await mergeCustomer(req.params.id, req.body?.into_customer_id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/api/customers/:id/residency", async (req: AuthedRequest, res) => {
    try {
      await updateCustomerResidency(req.params.id, req.body?.residency, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });
}
