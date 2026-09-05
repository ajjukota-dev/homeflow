import { randomUUID } from "node:crypto";
import type { Express } from "express";
import {
  createManualAction,
  claimAction,
  reassignAction,
  startAction,
  waitAction,
  blockAction,
  unblockAction,
  submitForApproval,
  approveAction,
  rejectAction,
  closeAction,
  cancelAction,
  addEvidence,
  verifyEvidence,
  setChecklistItem,
  listActions,
  getQueue,
} from "./actions/core";
import { db } from "./db";
import { files } from "./ports/files";
import { assertAllowedContentType } from "./ports/files/types";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { AppError } from "./authz/types";

/** Express adapter for Universal Action (10-universal-action.md). Handlers stay Express-free —
 *  every handler throws AppError only. `verify`/`reject` on evidence and `checklist` items are
 *  addressed by their own ids (`:eid`, `:item`) per the spec's own API list. */
export function registerActionRoutes(app: Express) {
  app.get("/api/actions", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await listActions(
          {
            owner_user_id: (req.query.owner === "me" ? req.actor!.user_id : (req.query.user_id as string)) || undefined,
            owner_role: req.query.owner_role as string | undefined,
            status: req.query.status as never,
            project_id: req.query.project_id as string | undefined,
          },
          { actor: req.actor! }
        ),
      });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/actions", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: { id: await createManualAction(req.body ?? {}, { actor: req.actor! }) } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/queues/:role", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getQueue(req.params.role, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/actions/:id/claim", async (req: AuthedRequest, res) => {
    try { await claimAction(req.params.id, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/start", async (req: AuthedRequest, res) => {
    try { await startAction(req.params.id, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/wait", async (req: AuthedRequest, res) => {
    try {
      const target = req.body?.target === "Waiting Internal" ? "Waiting Internal" : "Waiting Customer";
      await waitAction(req.params.id, target, req.body?.reason, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/block", async (req: AuthedRequest, res) => {
    try {
      await blockAction(req.params.id, req.body?.reason, req.body?.depends_on_action_id ?? null, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/unblock", async (req: AuthedRequest, res) => {
    try { await unblockAction(req.params.id, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/submit-approval", async (req: AuthedRequest, res) => {
    try { await submitForApproval(req.params.id, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/approve", async (req: AuthedRequest, res) => {
    try { await approveAction(req.params.id, req.body?.note, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/reject", async (req: AuthedRequest, res) => {
    try { await rejectAction(req.params.id, req.body?.reason, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/close", async (req: AuthedRequest, res) => {
    try { await closeAction(req.params.id, req.body?.note, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/cancel", async (req: AuthedRequest, res) => {
    try { await cancelAction(req.params.id, req.body?.reason, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/reassign", async (req: AuthedRequest, res) => {
    try {
      if (!req.body?.owner_user_id) throw new AppError("validation", "owner_user_id is required", "owner_user_id");
      await reassignAction(req.params.id, req.body.owner_user_id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });

  // Presigned evidence upload: mint the storage key + PUT URL, then record the evidence row
  // pointing at that key (ports/files/types.ts's key convention — project/{project_id}/...).
  app.post("/api/actions/:id/evidence", async (req: AuthedRequest, res) => {
    try {
      const contentType = req.body?.content_type as string | undefined;
      if (!contentType) throw new AppError("validation", "content_type is required", "content_type");
      assertAllowedContentType(contentType);
      const action = await db.query<{ project_id: string | null }>(`SELECT project_id FROM action WHERE id = $1`, [req.params.id]);
      if (!action.rows[0]) throw new AppError("not_found", "action not found");
      const ext = contentType.split("/")[1] ?? "bin";
      const key = `project/${action.rows[0].project_id ?? "unscoped"}/action/${req.params.id}/${randomUUID()}.${ext}`;
      const upload = await files.putPresigned(key, contentType);
      const evidenceId = await addEvidence(req.params.id, key, req.body?.kind, { actor: req.actor! });
      res.json({ data: { evidence_id: evidenceId, upload } });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/actions/:id/evidence/:eid/verify", async (req: AuthedRequest, res) => {
    try { await verifyEvidence(req.params.eid, "VERIFIED", req.body?.note, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/actions/:id/evidence/:eid/reject", async (req: AuthedRequest, res) => {
    try { await verifyEvidence(req.params.eid, "REJECTED", req.body?.note, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/actions/:id/checklist/:item", async (req: AuthedRequest, res) => {
    try {
      await setChecklistItem(req.params.id, req.params.item, Boolean(req.body?.checked), { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) { failHttp(res, e); }
  });
}
