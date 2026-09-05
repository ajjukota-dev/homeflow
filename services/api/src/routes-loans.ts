import type { Express } from "express";
import { createLoanCase, patchLoanCase, recordLoanEvent, putLoanDocuments, listProjectLoans, getBookingLoan, getLoanRisk } from "./loans/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

// 21-loans.md's API list, verbatim.

export function registerLoanRoutes(app: Express) {
  app.get("/api/bookings/:id/loan", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getBookingLoan(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/bookings/:id/loan", async (req: AuthedRequest, res) => {
    try {
      const data = await createLoanCase(
        req.params.id,
        { lender_name: req.body?.lender_name, requested_amount_inr: req.body?.requested_amount_inr, own_contribution_inr: req.body?.own_contribution_inr },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.patch("/api/loans/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await patchLoanCase(req.params.id, req.body ?? {}, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/loans/:id/events", async (req: AuthedRequest, res) => {
    try {
      const data = await recordLoanEvent(req.params.id, { type: req.body?.type, amount_inr: req.body?.amount_inr, note: req.body?.note }, { actor: req.actor! });
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.put("/api/loans/:id/documents", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putLoanDocuments(req.params.id, req.body?.requirements ?? [], { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/loans", async (req: AuthedRequest, res) => {
    try {
      const data = await listProjectLoans(
        req.params.id,
        { stage: req.query.stage as string | undefined, risk: req.query.risk as "high" | "low" | undefined },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/loans/:id/risk", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getLoanRisk(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });
}
