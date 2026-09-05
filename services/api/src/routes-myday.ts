import type { Express } from "express";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";
import { getMyDay, getTeamDay } from "./myday/core";

// 11-my-day-ranking.md's API list — `GET/PUT /ranking-weights` (Studio) deferred, same reasoning
// as every other spec's Studio UI so far. No dedicated permission_matrix module for My Day (it's
// inherently scoped to the caller's own actions/project_ids, same as `getTeamDay`'s own real
// MANAGEMENT/primary-owner gate) — nothing further to authorize at the route layer.

export function registerMyDayRoutes(app: Express) {
  app.get("/api/me/day", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getMyDay({ actor: req.actor! }, req.query.project_id as string | undefined) }); } catch (e) { failHttp(res, e); }
  });

  // Spec names this route by team id, but `project_team_assignment` (the only real membership
  // data) has no dedicated per-team roster query built anywhere yet — `:id` is treated as a
  // project id here (aggregates every member assigned to that project), a real simplification,
  // flagged rather than inventing team-hierarchy grouping this slice doesn't need yet.
  app.get("/api/teams/:id/day", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getTeamDay({ actor: req.actor! }, req.params.id) }); } catch (e) { failHttp(res, e); }
  });
}
