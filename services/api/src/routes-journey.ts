import type { Express } from "express";
import {
  listTemplates,
  listVersions,
  createTemplate,
  createVersion,
  getVersion,
  putVersionContent,
  publishVersion,
  assignTemplateToProject,
  previewVersion,
} from "./journey/templates";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

/** Express adapter for Journey Template Studio (05-journey-templates.md). Handlers stay
 *  Express-free; every handler throws AppError only, so no legacy-shape fallback is needed
 *  (contrast routes-model.ts/routes-lifecycle.ts, which still adapt pre-R0.6 throw shapes). */
export function registerJourneyRoutes(app: Express) {
  app.get("/api/journey-templates", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listTemplates({ actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journey-templates", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: { id: await createTemplate(req.body ?? {}, { actor: req.actor! }) } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/journey-templates/:id/versions", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listVersions(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journey-templates/:id/versions", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: { id: await createVersion(req.params.id, { actor: req.actor! }) } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  // 05's own API line: `GET /journey-templates/versions/:vid/preview?product_type&residency`
  // ("which tasks instantiate"). previewVersion is pure (content in, result out) — read the
  // version through the same ctx-gated getVersion the editor uses, then evaluate.
  app.get("/api/journey-template-versions/:id/preview", async (req: AuthedRequest, res) => {
    try {
      const version = await getVersion(req.params.id, { actor: req.actor! });
      const result = previewVersion(
        { stages: version.stages, dependencies: version.dependencies },
        { product_type: req.query.product_type as string | undefined, residency: req.query.residency as string | undefined }
      );
      res.json({ data: result });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.get("/api/journey-template-versions/:id", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getVersion(req.params.id, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.put("/api/journey-template-versions/:id/content", async (req: AuthedRequest, res) => {
    try {
      await putVersionContent(req.params.id, req.body ?? { stages: [] }, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/journey-template-versions/:id/publish", async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await publishVersion(req.params.id, req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      failHttp(res, e);
    }
  });

  app.post("/api/projects/:id/journey-template-version", async (req: AuthedRequest, res) => {
    try {
      await assignTemplateToProject(req.params.id, req.body?.version_id, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      failHttp(res, e);
    }
  });
}
