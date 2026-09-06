import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { db } from "./db";
import { failHttp } from "./authz/httpError";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";
import { AppError } from "./authz/types";
import { computeCustomerHealth, explainCustomerHealth } from "./intelligence/customer-health";
import { computeFinancialHealth, explainFinancialHealth } from "./intelligence/financial-health";
import { computeJourneyRisk, explainJourneyRisk } from "./intelligence/journey-risk";
import { computeCollectionRisk } from "./intelligence/collection-risk";
import { computeCommitmentRisk } from "./intelligence/commitment-risk";
import { getNextBestAction } from "./intelligence/next-best-action";
import { createTask, acceptTask, rejectTask, listSuggestions, loadSuggestion, type LlmTaskKind } from "./intelligence/llm-tasks";

// 31-intelligence.md API. No dedicated `permission_matrix` module exists for these composites
// (same gap class as 14's own booking-readiness/handover-readiness routes) — gated on any staff
// role, matching that exact precedent, rather than inventing a matrix row nothing else populates.
export function registerIntelligenceRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });
  const staff = (req: AuthedRequest) => requireRole(ctx(req), STAFF_ROLES);

  app.get("/api/bookings/:id/scores/customer-health", async (req: AuthedRequest, res) => {
    try {
      staff(req);
      const customerId = await customerIdForBooking(req.params.id);
      res.json({ data: await computeCustomerHealth(customerId) });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customers/:id/scores/customer-health", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await computeCustomerHealth(req.params.id) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/customers/:id/scores/customer-health/explain", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await explainCustomerHealth(req.params.id) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/financial-health", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await computeFinancialHealth(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/bookings/:id/scores/financial-health/explain", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await explainFinancialHealth(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/scores/journey-risk", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await computeJourneyRisk(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/bookings/:id/scores/journey-risk/explain", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await explainJourneyRisk(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/demands/:id/risk", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await computeCollectionRisk(req.params.id) }); } catch (e) { failHttp(res, e); }
  });

  // Not in the spec's own API shorthand list, added symmetrically per rule 3's "All exposed via
  // /scores/*" — see intelligence/commitment-risk.ts's own header.
  app.get("/api/commitments/:id/risk", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await computeCommitmentRisk(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/bookings/:id/next-best-action", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await getNextBestAction(req.params.id) }); } catch (e) { failHttp(res, e); }
  });

  const VALID_KINDS: LlmTaskKind[] = ["COMMITMENT_DETECTION", "COMMUNICATION_SUMMARY", "SENTIMENT", "DOCUMENT_FIELD_EXTRACTION", "DOCUMENT_INCONSISTENCY", "SNAG_ROOT_CAUSE_SUGGESTION"];

  app.post("/api/llm/tasks", async (req: AuthedRequest, res) => {
    try {
      staff(req);
      const { kind, input_ref } = req.body ?? {};
      if (!VALID_KINDS.includes(kind)) throw new AppError("validation", `kind must be one of ${VALID_KINDS.join(", ")}`, "kind");
      if (!input_ref) throw new AppError("validation", "input_ref is required", "input_ref");
      res.status(201).json({ data: await createTask(kind, input_ref) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/llm/tasks", async (req: AuthedRequest, res) => {
    try {
      const { kind, accepted } = req.query as Record<string, string | undefined>;
      const acceptedFilter = accepted === undefined ? undefined : accepted === "true";
      res.json({ data: await listSuggestions(kind as LlmTaskKind | undefined, acceptedFilter, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/llm/tasks/:id", async (req: AuthedRequest, res) => {
    try { staff(req); res.json({ data: await loadSuggestion(req.params.id) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/llm/tasks/:id/accept", async (req: AuthedRequest, res) => {
    try { res.json({ data: await acceptTask(req.params.id, ctx(req), req.body ?? {}) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/llm/tasks/:id/reject", async (req: AuthedRequest, res) => {
    try { res.json({ data: await rejectTask(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/llm/usage", async (req: AuthedRequest, res) => {
    try {
      staff(req);
      const r = await db.query<{ total_calls: string; total_tokens: string; total_cost_inr: number }>(
        `SELECT count(*) AS total_calls, COALESCE(SUM(tokens), 0) AS total_tokens, COALESCE(SUM(cost_inr), 0)::float8 AS total_cost_inr
           FROM llm_call WHERE created_at >= date_trunc('month', now())`
      );
      res.json({ data: { month_to_date: r.rows[0] } });
    } catch (e) { failHttp(res, e); }
  });
}

async function customerIdForBooking(bookingId: string): Promise<string> {
  const r = await db.query<{ customer_id: string | null }>(
    `SELECT a.customer_id FROM booking_applicant a WHERE a.booking_id = $1 AND a.role = 'primary'`,
    [bookingId]
  );
  if (!r.rows[0]?.customer_id) throw new AppError("not_found", "primary applicant/customer not found for this booking");
  return r.rows[0].customer_id;
}
