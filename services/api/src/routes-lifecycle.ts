import type { Express } from "express";
import {
  listLegalQueue,
  generateDocument,
  approveDocument,
  executeDocument,
  completeRegistration,
} from "./legal-docs";
import {
  projectReadiness,
  verifyComponent,
  closeSnag,
  projectHandover,
  completeHandover,
} from "./qa";
import { projectWarranty, serviceHistory, closeWarranty, captureCheckin } from "./warranty";
import { controlTower, actIntervention } from "./tower-view";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { AppError } from "./authz/types";

// Preserves the pre-R0.6 shapes (validation `.errors` array, bare "not_found" message)
// that generateDocument/verifyComponent/captureCheckin etc. still throw, while routing
// authorize()'s AppError("forbidden"/"not_found") through the same status mapping.
function fail(res: import("express").Response, e: unknown) {
  if (e instanceof AppError) return failHttp(res, e);
  const err = e as Error & { errors?: unknown };
  if (err.errors) return res.status(400).json({ errors: err.errors });
  if (err.message === "not_found") return res.status(404).json({ errors: [{ code: "not_found" }] });
  res.status(400).json({ errors: [{ code: "bad_request", message: String(err.message ?? e) }] });
}

/** Express adapter for legal / QA / handover / warranty / tower. Handlers stay Express-free. */
export function registerLifecycleRoutes(app: Express) {
  app.get("/api/projects/:id/legal", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listLegalQueue(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/bookings/:id/documents/generate", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await generateDocument(req.params.id, req.body?.document_family ?? "AOS", { actor: req.actor! }),
      });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/documents/:id/approve", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await approveDocument(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/documents/:id/execute", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await executeDocument(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/bookings/:id/registration/complete", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await completeRegistration(req.params.id, req.body?.sro_reference ?? "SRO/LOCAL", {
          actor: req.actor!,
        }),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/projects/:id/readiness", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await projectReadiness(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/units/:id/qa/:component/verify", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await verifyComponent(req.params.id, req.params.component, req.body?.evidence_note, {
          actor: req.actor!,
        }),
      });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/snags/:id/close", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await closeSnag(req.params.id, req.body?.before_note, req.body?.after_note, { actor: req.actor! }),
      });
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/api/projects/:id/handover", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await projectHandover(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/bookings/:id/handover/complete", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await completeHandover(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/projects/:id/warranty", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await projectWarranty(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/api/units/:id/service-history", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await serviceHistory(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/warranty-cases/:id/close", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await closeWarranty(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/checkins/:id/capture", async (req: AuthedRequest, res) => {
    try {
      res.json({
        data: await captureCheckin(req.params.id, Number(req.body?.satisfaction_score), { actor: req.actor! }),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/projects/:id/control-tower", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await controlTower(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/interventions/:id/act", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await actIntervention(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });
}
