import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { AppError } from "./authz/types";
import { getPostHandoverCase, completeMoveInTask, getUnitPassport, putPassportItem, addServiceRecord } from "./post-handover/core";
import {
  createWarrantyCase, listWarrantyCases, getWarrantyCase, triageWarrantyCase, assignWarrantyCase, quoteWarrantyCase,
  acceptQuote, waiveQuote, startWarrantyCase, resolveWarrantyCase, verifyWarrantyCase, closeWarrantyCase, rejectWarrantyCase,
} from "./post-handover/warranty";
import { inviteAdvocacy, respondAdvocacy, listAdvocacy } from "./post-handover/advocacy";

// 30-post-handover.md API.
export function registerPostHandoverRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/bookings/:id/post-handover", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getPostHandoverCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/post-handover/:id/move-in-tasks", async (req: AuthedRequest, res) => {
    try {
      const { task_key } = req.body ?? {};
      if (!task_key) throw new AppError("validation", "task_key is required", "task_key");
      res.json({ data: await completeMoveInTask(req.params.id, task_key, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/warranty-cases", async (req: AuthedRequest, res) => {
    try {
      const { unit_id, booking_id, project_id, status } = req.query as Record<string, string | undefined>;
      res.json({ data: await listWarrantyCases({ unit_id, booking_id, project_id, status }, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await createWarrantyCase(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/warranty-cases/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getWarrantyCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/triage", async (req: AuthedRequest, res) => {
    try { res.json({ data: await triageWarrantyCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/assign", async (req: AuthedRequest, res) => {
    try {
      const { contractor_id } = req.body ?? {};
      if (!contractor_id) throw new AppError("validation", "contractor_id is required", "contractor_id");
      res.json({ data: await assignWarrantyCase(req.params.id, contractor_id, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/quote", async (req: AuthedRequest, res) => {
    try {
      const { quote_inr } = req.body ?? {};
      if (typeof quote_inr !== "number") throw new AppError("validation", "quote_inr is required", "quote_inr");
      res.json({ data: await quoteWarrantyCase(req.params.id, quote_inr, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/accept-quote", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acceptQuote(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/waive-quote", async (req: AuthedRequest, res) => {
    try { res.json({ data: await waiveQuote(req.params.id, (req.body ?? {}).reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/start", async (req: AuthedRequest, res) => {
    try { res.json({ data: await startWarrantyCase(req.params.id, (req.body ?? {}).before_file_keys, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/resolve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await resolveWarrantyCase(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/verify", async (req: AuthedRequest, res) => {
    try { res.json({ data: await verifyWarrantyCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/close", async (req: AuthedRequest, res) => {
    try { res.json({ data: await closeWarrantyCase(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/warranty-cases/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectWarrantyCase(req.params.id, (req.body ?? {}).reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/units/:id/passport", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUnitPassport(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/units/:id/passport", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putPassportItem(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/service-records", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await addServiceRecord(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/advocacy/invite", async (req: AuthedRequest, res) => {
    try {
      const { booking_id, kind } = req.body ?? {};
      if (!booking_id || !kind) throw new AppError("validation", "booking_id and kind are required");
      res.status(201).json({ data: await inviteAdvocacy(booking_id, kind, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/advocacy", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listAdvocacy(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/advocacy/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await respondAdvocacy(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
