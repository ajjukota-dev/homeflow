import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { AppError } from "./authz/types";
import { logCommunication, sendCommunicationEmail, publishCommunicationToPortal, listCustomerCommunications, getGuardrailStatus, getCommunication } from "./communications/core";
import {
  createCommunicationTemplate, submitTemplateForLegalReview, approveCommunicationTemplate, listCommunicationTemplates, previewCommunicationTemplate,
} from "./communications/templates";
import { createInternalNote, listInternalNotes } from "./communications/notes";

// 29-communications.md API.
export function registerCommunicationsRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/customers/:id/communications", async (req: AuthedRequest, res) => {
    try {
      const { channel, visibility } = req.query as { channel?: string; visibility?: string };
      res.json({ data: await listCustomerCommunications(req.params.id, { channel, visibility }, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communications", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await logCommunication(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communications/send-email", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await sendCommunicationEmail(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communications/:id/publish-to-portal", async (req: AuthedRequest, res) => {
    try { res.json({ data: await publishCommunicationToPortal(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  // Send-email flow's own pre-flight checks (rule 4's "blocked with the last-sent facts" UX and
  // rule 3's "preview before send") — both call existing pure functions, no new domain logic.
  app.get("/api/communications/guardrail-status", async (req: AuthedRequest, res) => {
    try {
      const { customer_id, template_id } = req.query as { customer_id?: string; template_id?: string };
      if (!customer_id) throw new AppError("validation", "customer_id is required");
      res.json({ data: await getGuardrailStatus(customer_id, template_id, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  // Registered after every static-segment /api/communications/* GET above (guardrail-status) —
  // Express matches in registration order, and this :id wildcard would otherwise shadow them.
  app.get("/api/communications/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getCommunication(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communication-templates/:id/preview", async (req: AuthedRequest, res) => {
    try { res.json({ data: await previewCommunicationTemplate(req.params.id, req.body?.booking_id ?? null) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/communication-templates", async (req: AuthedRequest, res) => {
    try {
      const { channel, purpose, project_id } = req.query as { channel?: string; purpose?: string; project_id?: string };
      res.json({ data: await listCommunicationTemplates({ channel, purpose, project_id }, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communication-templates", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await createCommunicationTemplate(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communication-templates/:id/submit-legal-review", async (req: AuthedRequest, res) => {
    try { res.json({ data: await submitTemplateForLegalReview(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/communication-templates/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveCommunicationTemplate(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/internal-notes", async (req: AuthedRequest, res) => {
    try { res.status(201).json({ data: await createInternalNote(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/internal-notes", async (req: AuthedRequest, res) => {
    try {
      const { entity_type, entity_id } = req.query as { entity_type?: string; entity_id?: string };
      if (!entity_type || !entity_id) throw new AppError("validation", "entity_type and entity_id are required");
      res.json({ data: await listInternalNotes(entity_type, entity_id, ctx(req)) });
    } catch (e) { failHttp(res, e); }
  });
}
