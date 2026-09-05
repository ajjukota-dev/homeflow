import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { listInventory, compareUnits } from "./sales/inventory";
import { listProspects, getProspect, createProspect, putNeeds, getMatches, markProspectLost, lostRequirementAnalytics } from "./sales/prospects";
import { requestHold, approveHold, rejectHold, releaseHold, listHolds } from "./sales/holds";
import { bookFromInventory, confirmInventoryBooking } from "./sales/booking";
import { getHoldPolicy, putHoldPolicy } from "./sales/policy";

// 24-sales-inventory-discovery.md's API list. The pre-24 GET /api/units (handlers.ts) and
// POST /api/units/:id/book (bookings.ts) stay for the existing console.

const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? v.split(",").filter(Boolean) : undefined);

export function registerSalesRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/projects/:id/inventory", async (req: AuthedRequest, res) => {
    const q = req.query as Record<string, unknown>;
    try {
      res.json({
        data: await listInventory(req.params.id, {
          node_id: q.node_id as string | undefined, sale_status: q.sale_status as string | undefined, facing: q.facing as string | undefined,
          min_price: q.min_price ? Number(q.min_price) : undefined, max_price: q.max_price ? Number(q.max_price) : undefined,
          named: list(q.filters), sort: q.sort as "price" | "flexibility" | "possession" | "unit_number" | undefined,
        }, ctx(req)),
      });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/inventory/compare", async (req: AuthedRequest, res) => {
    try { res.json({ data: await compareUnits(list(req.query.unit_ids) ?? [], req.query.prospect_id as string | undefined, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/prospects", async (req: AuthedRequest, res) => {
    const projectId = req.query.project_id as string | undefined;
    if (!projectId) return res.status(400).json({ errors: [{ code: "missing_fields", field: "project_id" }] });
    try { res.json({ data: await listProspects(projectId, req.query.status as string | undefined, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/prospects", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createProspect(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/prospects/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getProspect(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/prospects/:id/needs", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putNeeds(req.params.id, req.body?.needs, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/prospects/:id/matches", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getMatches(req.params.id, list(req.query.unit_ids), ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/prospects/:id/lost", async (req: AuthedRequest, res) => {
    try { res.json({ data: await markProspectLost(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/prospects/:id/book", async (req: AuthedRequest, res) => {
    try { res.json({ data: await bookFromInventory(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/bookings/:id/confirm-inventory", async (req: AuthedRequest, res) => {
    try { res.json({ data: await confirmInventoryBooking(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/projects/:id/lost-requirements", async (req: AuthedRequest, res) => {
    try { res.json({ data: await lostRequirementAnalytics(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/holds", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listHolds(req.params.id, req.query.status as string | undefined, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/holds", async (req: AuthedRequest, res) => {
    try { res.json({ data: await requestHold(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/holds/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveHold(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/holds/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectHold(req.params.id, req.body?.note, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/holds/:id/release", async (req: AuthedRequest, res) => {
    try { res.json({ data: await releaseHold(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/hold-policy", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getHoldPolicy((req.query.project_id as string | undefined) ?? null, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/hold-policy", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putHoldPolicy(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
