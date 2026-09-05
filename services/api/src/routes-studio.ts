import type { Express } from "express";
import { tabsForRoles } from "./studio/registry";
import { listStudioTable, draftStudioRow, publishStudioRow, studioRowHistory, previewStudioChange } from "./studio/core";
import { createApprovalRule, listApprovalRules } from "./approvals/matrix";
import { exportProjectConfig, importProjectConfig } from "./studio/config";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { AppError } from "./authz/types";

/** Express adapter for Policy Studio (25-policy-studio.md). Handlers stay Express-free — every
 *  handler throws AppError only. */
export function registerStudioRoutes(app: Express) {
  app.get("/api/studio/tabs", async (req: AuthedRequest, res) => {
    try { res.json({ data: tabsForRoles(req.actor!.roles) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/studio/:table", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listStudioTable(req.params.table, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/studio/:table", async (req: AuthedRequest, res) => {
    try {
      const id = await draftStudioRow(req.params.table, req.body?.row_id ?? null, req.body?.values ?? {}, req.body?.note, { actor: req.actor! });
      res.json({ data: { id } });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/studio/:table/:id/publish", async (req: AuthedRequest, res) => {
    try {
      if (!req.body?.effective_from) throw new AppError("validation", "effective_from is required", "effective_from");
      await publishStudioRow(req.params.table, req.params.id, req.body.effective_from, req.body?.note, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/studio/:table/:id/history", async (req: AuthedRequest, res) => {
    try { res.json({ data: await studioRowHistory(req.params.table, req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  // previewStudioChange's return type is `never` — it always throws (not implemented for any
  // registered table yet, see studio/core.ts), so failHttp always sends the response. No res.json
  // on a success path is intentional today; the day preview is implemented for a table, this
  // route needs a `res.json({ data: ... })` added alongside the throw, or requests will hang.
  app.post("/api/studio/:table/preview", async (req: AuthedRequest, res) => {
    try { await previewStudioChange(req.params.table); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/approval-authority-rules", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listApprovalRules({ actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/approval-authority-rules", async (req: AuthedRequest, res) => {
    try {
      const id = await createApprovalRule(
        {
          domain: req.body?.domain,
          metric: req.body?.metric,
          min: req.body?.min ?? null,
          max: req.body?.max ?? null,
          approver_role: req.body?.approver_role,
          second_approver_role: req.body?.second_approver_role ?? null,
          project_id: req.body?.project_id ?? null,
          product_types: req.body?.product_types ?? null,
          effective_from: req.body?.effective_from,
          effective_to: req.body?.effective_to ?? null,
        },
        { actor: req.actor! }
      );
      res.json({ data: { id } });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/config/export", async (req: AuthedRequest, res) => {
    try { res.json({ data: await exportProjectConfig(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  // importProjectConfig is a stub that always throws (see studio/config.ts) — same
  // response-less-by-construction contract as the preview route above.
  app.post("/api/projects/:id/config/import", async (req: AuthedRequest, res) => {
    try { await importProjectConfig(req.params.id, { actor: req.actor! }); } catch (e) { failHttp(res, e); }
  });
}
