import type { Express } from "express";
import {
  createCommitment,
  listCommitments,
  getCommitment,
  commitmentsForBooking,
  approveCommitment,
  activateCommitment,
  fulfilCommitment,
  waiveCommitment,
  setAtRisk,
  recordRecoveryPlan,
  recordRootCause,
  scanCommitments,
} from "./commitments/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { requireRole, STAFF_ROLES } from "./authz/requireRole";

// 13-promise-ledger.md's API list — analytics endpoint and Studio config (approver matrix,
// pre-breach leads, root-cause list, categories, ₹ threshold) deferred, same reasoning as every
// other spec's Studio UI/analytics page so far.

export function registerCommitmentRoutes(app: Express) {
  app.get("/api/bookings/:id/commitments", async (req: AuthedRequest, res) => {
    try { res.json({ data: await commitmentsForBooking(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createCommitment(req.body, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/commitments", async (req: AuthedRequest, res) => {
    try {
      const data = await listCommitments(
        {
          status: req.query.status as string | undefined,
          owner_user_id: req.query.owner as string | undefined,
          responsible_department: req.query.department as string | undefined,
          due_before: req.query.due_before as string | undefined,
          project_id: req.query.project_id as string | undefined,
        },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/commitments/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCommitment(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveCommitment(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/activate", async (req: AuthedRequest, res) => {
    try { res.json({ data: await activateCommitment(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/fulfil", async (req: AuthedRequest, res) => {
    try { res.json({ data: await fulfilCommitment(req.params.id, req.body, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/waive", async (req: AuthedRequest, res) => {
    try { res.json({ data: await waiveCommitment(req.params.id, req.body?.reason, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/set-at-risk", async (req: AuthedRequest, res) => {
    try { res.json({ data: await setAtRisk(req.params.id, req.body?.reason, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/recovery-plan", async (req: AuthedRequest, res) => {
    try { res.json({ data: await recordRecoveryPlan(req.params.id, req.body?.recovery_plan, req.body?.recovery_due_date, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/commitments/:id/root-cause", async (req: AuthedRequest, res) => {
    try { res.json({ data: await recordRootCause(req.params.id, req.body?.breach_root_cause, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  // Not a real cron (no scheduler exists anywhere in this codebase) — same manually-triggerable
  // shape 12's own /escalations/scan already established.
  app.post("/api/commitments/scan", async (req: AuthedRequest, res) => {
    try {
      requireRole({ actor: req.actor! }, STAFF_ROLES);
      res.json({ data: await scanCommitments() });
    } catch (e) { failHttp(res, e); }
  });
}
