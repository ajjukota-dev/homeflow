import type { Express } from "express";
import { disputeReceipt, verifyReceipt } from "./demands-receipts";
import { suggestTdsApplicability, upsertTdsRecord, verifyTds, rejectTds } from "./tds";
import { requestWaiver, approveWaiver, rejectWaiver, listWaivers, type WaiverKind } from "./waivers";
import { getClearance, updateClearanceChecklist, approveClearance, rejectClearance, type ClearancePurpose } from "./financial-clearance";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

// Routes new to 19-collections-true-risk.md — the pre-existing H3-era demand/receipt/collections
// routes stay inline in server.ts (untouched, except overdue-reason's new optional `note` param).
// Not built here, per the spec's own "Not in this feature"/dependency list: GET /payment-plans
// Studio CRUD (payment_plan isn't in 25's TABLE_REGISTRY — only one plan per project exists today,
// nothing to select between yet), GET .../collections/ageing (banded rollup), GET .../statement
// (needs 22, document rendering).

export function registerCollectionsRoutes(app: Express) {
  app.post("/api/receipts/:id/verify", async (req: AuthedRequest, res) => {
    try {
      await verifyReceipt(req.params.id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/receipts/:id/dispute", async (req: AuthedRequest, res) => {
    try {
      await disputeReceipt(req.params.id, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/tds/suggest", async (req: AuthedRequest, res) => {
    try { res.json({ data: await suggestTdsApplicability(req.params.id) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/bookings/:id/tds", async (req: AuthedRequest, res) => {
    try {
      const data = await upsertTdsRecord(
        req.params.id,
        { demand_id: req.body?.demand_id ?? null, applicability: req.body?.applicability, na_reason: req.body?.na_reason ?? null, amount: req.body?.amount ?? null },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/tds/:id/verify", async (req: AuthedRequest, res) => {
    try {
      const data = await verifyTds(
        req.params.id,
        { challan_number: req.body?.challan_number, challan_date: req.body?.challan_date, pan: req.body?.pan, file_id: req.body?.file_id },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/tds/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectTds(req.params.id, req.body?.reason, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/waivers", async (req: AuthedRequest, res) => {
    try {
      const data = await requestWaiver(
        {
          booking_id: req.body?.booking_id,
          demand_id: req.body?.demand_id,
          kind: req.body?.kind as WaiverKind,
          amount: Number(req.body?.amount),
          reason: req.body?.reason,
        },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/waivers/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveWaiver(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/waivers/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectWaiver(req.params.id, req.body?.reason, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/waivers", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listWaivers(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/clearance", async (req: AuthedRequest, res) => {
    try {
      const purpose = (req.query.purpose as ClearancePurpose | undefined) ?? "REGISTRATION";
      res.json({ data: await getClearance(req.params.id, purpose, { actor: req.actor! }) });
    } catch (e) { failHttp(res, e); }
  });

  app.put("/api/bookings/:id/clearance/checklist", async (req: AuthedRequest, res) => {
    try {
      const purpose = (req.body?.purpose as ClearancePurpose | undefined) ?? "REGISTRATION";
      res.json({ data: await updateClearanceChecklist(req.params.id, purpose, req.body?.checklist ?? {}, { actor: req.actor! }) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/bookings/:id/clearance/approve", async (req: AuthedRequest, res) => {
    try {
      const purpose = (req.body?.purpose as ClearancePurpose | undefined) ?? "REGISTRATION";
      res.json({ data: await approveClearance(req.params.id, purpose, { actor: req.actor! }) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/bookings/:id/clearance/reject", async (req: AuthedRequest, res) => {
    try {
      const purpose = (req.body?.purpose as ClearancePurpose | undefined) ?? "REGISTRATION";
      res.json({ data: await rejectClearance(req.params.id, purpose, req.body?.reason, { actor: req.actor! }) });
    } catch (e) { failHttp(res, e); }
  });
}
