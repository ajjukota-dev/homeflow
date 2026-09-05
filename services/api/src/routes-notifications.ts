import type { Express } from "express";
import { listNotifications, markNotificationRead, getNotificationPreferences, setNotificationPreferences } from "./notifications/core";
import type { AuthedRequest } from "./auth/middleware";
import { failHttp } from "./authz/httpError";

// 12-escalations-notifications.md's notification-facing API list.

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications", async (req: AuthedRequest, res) => {
    try { res.json({ data: await listNotifications({ actor: req.actor! }, req.query.unread === "true") }); } catch (e) { failHttp(res, e); }
  });

  app.post("/api/notifications/:id/read", async (req: AuthedRequest, res) => {
    try { await markNotificationRead(req.params.id, { actor: req.actor! }); res.json({ data: { ok: true } }); } catch (e) { failHttp(res, e); }
  });

  app.get("/api/me/notification-preferences", async (req: AuthedRequest, res) => {
    try { res.json({ data: await getNotificationPreferences({ actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });

  app.put("/api/me/notification-preferences", async (req: AuthedRequest, res) => {
    try { res.json({ data: await setNotificationPreferences(req.body ?? {}, { actor: req.actor! }) }); } catch (e) { failHttp(res, e); }
  });
}
