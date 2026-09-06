import type { Express } from "express";
import {
  getForecast,
  overrideForecastLine,
  listScenarios,
  createScenario,
  putScenarioAssumptions,
  takeSnapshot,
  listSnapshots,
  compareForecast,
  portfolioCompare,
} from "./forecast/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

// 20-cash-forecast.md's API list, verbatim.

export function registerForecastRoutes(app: Express) {
  app.get("/api/projects/:id/forecast", async (req: AuthedRequest, res) => {
    try {
      const data = await getForecast(
        req.params.id,
        {
          scenario: req.query.scenario as string | undefined,
          from: req.query.from as string | undefined,
          to: req.query.to as string | undefined,
          lane: req.query.lane as "COMMITTED" | "SCENARIO" | undefined,
        },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.post("/api/projects/:id/forecast/snapshots", async (req: AuthedRequest, res) => {
    try { res.json({ data: await takeSnapshot(req.params.id, "MANUAL", { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/forecast/snapshots", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listSnapshots(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/forecast/compare", async (req: AuthedRequest, res) => {
    try { res.json({ data: await compareForecast(req.params.id, req.query.period as string, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/projects/:id/scenarios", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listScenarios(req.params.id, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/projects/:id/scenarios", async (req: AuthedRequest, res) => {
    try { res.json({ data: await createScenario(req.params.id, { code: req.body?.code }, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/scenarios/:id/assumptions", async (req: AuthedRequest, res) => {
    try { res.json({ data: await putScenarioAssumptions(req.params.id, req.body?.assumptions ?? [], { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/forecast-lines/:id/override", async (req: AuthedRequest, res) => {
    try {
      const data = await overrideForecastLine(
        req.params.id,
        { expected_date: req.body?.expected_date, amount_inr: req.body?.amount_inr, probability: req.body?.probability, reason: req.body?.reason },
        { actor: req.actor! }
      );
      res.json({ data });
    } catch (e) { failHttp(res, e); }
  });

  app.get("/api/portfolio/forecast/compare", async (req: AuthedRequest, res) => {
    try { res.json({ data: await portfolioCompare(req.query.period as string, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });
}
