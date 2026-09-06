import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { controlTower, dismissIntervention } from "./management/interventions";
import { getKpis, drillKpi } from "./management/kpis";
import { getExceptions } from "./management/exceptions";
import { getProfitability } from "./management/profitability";
import { getPortfolio } from "./management/portfolio";
import { getTeamBottlenecks } from "./management/teams";

// 27-management-control-tower.md API. `GET /api/projects/:id/control-tower` and
// `POST /api/interventions/:id/act` stay in routes-lifecycle.ts (unchanged URLs — the live
// workspace ControlTower.tsx already calls them, `api-lifecycle.ts:167-168`), now pointed at this
// module's `controlTower`/`actIntervention` instead of the retired tower-view.ts. `GET /api/tower`
// here is the spec's own-named path, additive.
export function registerManagementRoutes(app: Express): void {
  const ctx = (req: AuthedRequest) => ({ actor: req.actor! });

  app.get("/api/tower", async (req: AuthedRequest, res) => {
    try { res.json({ data: await controlTower(String(req.query.project_id), ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.post("/api/interventions/:id/dismiss", async (req: AuthedRequest, res) => {
    try { res.json({ data: await dismissIntervention(req.params.id, req.body?.reason, ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/kpis", async (req: AuthedRequest, res) => {
    try {
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
      res.json({ data: await getKpis(String(req.query.project_id), ctx(req), domain, period) });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/kpis/:code/drill", async (req: AuthedRequest, res) => {
    try {
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      res.json({ data: await drillKpi(req.params.code, String(req.query.project_id), ctx(req), period) });
    } catch (e) { failHttp(res, e); }
  });
  app.get("/api/exceptions", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getExceptions(String(req.query.project_id), ctx(req), typeof req.query.kind === "string" ? req.query.kind : undefined) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/profitability", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getProfitability(String(req.query.project_id), ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/portfolio", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getPortfolio(ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
  app.get("/api/teams/bottlenecks", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getTeamBottlenecks(String(req.query.project_id), ctx(req)) }); } catch (e) { failHttp(res, e); }
  });
}
