import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { listBaselines, createBaseline, updateBaseline, approveBaseline } from "./specification/baselines";
import { getUnitSpecification, getRevision, addDrawing } from "./specification/revisions";
import { listCatalogue, putCatalogue } from "./specification/catalogue";

// 09-specification-revisions.md §API. Revision creation/release/as-built are 18's handlers' calls,
// not routes; the drawing upload is the one write here (DRAFT revisions only).
export function registerSpecificationRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/specification-baselines", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listBaselines(req.query.project_id as string | undefined, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/specification-baselines", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createBaseline(req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/specification-baselines/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await updateBaseline(req.params.id, req.body ?? {}, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/specification-baselines/:id/approve", async (req: AuthedRequest, res) => {
    try { res.json({ data: await approveBaseline(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/units/:id/specification", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getUnitSpecification(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/spec-revisions/:id", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getRevision(req.params.id, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/spec-revisions/:id/drawings", async (req: AuthedRequest, res) => {
    try { res.json({ data: await addDrawing(req.params.id, { content_type: req.body?.content_type }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/variation-catalogue", async (req: AuthedRequest, res) => {
    const q = req.query as Record<string, string | undefined>;
    try { res.json({ data: await listCatalogue({ project_id: q.project_id, category_code: q.category_code, include_inactive: q.include_inactive === "true" }, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.put("/api/variation-catalogue", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putCatalogue(req.body?.items ?? req.body, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
