import type { Express } from "express";
import { getProjectMaster, updateProject } from "./model/projects";
import { createHierarchyNode, listHierarchy } from "./model/hierarchy";
import { bulkCreateUnits } from "./model/units";
import { listApplicants, setApplicants } from "./model/applicants";
import { mergePreview, mergeCustomer, updateCustomerResidency } from "./model/customers";
import { confirmBooking, cancelBooking, transferBooking } from "./model/bookings";

function fail(res: { status: (n: number) => { json: (b: unknown) => void } }, e: unknown) {
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
  app.get("/api/projects/:id/master", async (req, res) => {
    const p = await getProjectMaster(req.params.id);
    if (!p) return res.status(404).json({ errors: [{ code: "not_found" }] });
    res.json({ data: p });
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      res.json({ data: await updateProject(req.params.id, req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/projects/:id/hierarchy", async (req, res) => {
    res.json({ data: await listHierarchy(req.params.id) });
  });

  app.post("/api/projects/:id/hierarchy", async (req, res) => {
    try {
      res.json({ data: await createHierarchyNode(req.params.id, req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Bulk unit range create (04 §Screens "Units") ---
  app.post("/api/projects/:id/units/bulk", async (req, res) => {
    try {
      const ids = await bulkCreateUnits(req.params.id, req.body ?? {});
      res.json({ data: { unit_ids: ids, count: ids.length } });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Booking applicants (04 rule 4) ---
  app.get("/api/bookings/:id/applicants", async (req, res) => {
    res.json({ data: await listApplicants(req.params.id) });
  });

  app.put("/api/bookings/:id/applicants", async (req, res) => {
    try {
      res.json({ data: await setApplicants(req.params.id, req.body?.applicants ?? []) });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Booking lifecycle: confirm / cancel / transfer (04 rule 3) ---
  app.post("/api/bookings/:id/confirm", async (req, res) => {
    try {
      await confirmBooking(req.params.id);
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/bookings/:id/cancel", async (req, res) => {
    try {
      await cancelBooking(req.params.id, req.body?.reason);
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/bookings/:id/transfer", async (req, res) => {
    try {
      const successorId = await transferBooking(req.params.id, req.body?.reason);
      res.json({ data: { successor_booking_id: successorId } });
    } catch (e) {
      fail(res, e);
    }
  });

  // --- Customer merge + residency (04 rule 5/6, §Screens "Customers") ---
  app.get("/api/customers/:id/merge-preview", async (req, res) => {
    try {
      res.json({ data: await mergePreview(req.params.id, req.query.into as string) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/customers/:id/merge", async (req, res) => {
    try {
      await mergeCustomer(req.params.id, req.body?.into_customer_id);
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/api/customers/:id/residency", async (req, res) => {
    try {
      await updateCustomerResidency(req.params.id, req.body?.residency);
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });
}
