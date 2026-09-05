import type { Express } from "express";
import { login } from "./login";
import { logout } from "./logout";
import { me } from "./me";
import { requestPasswordReset, completePasswordReset } from "./reset";
import { acceptInvite } from "./invite";
import { requireSession, type AuthedRequest } from "./middleware";
import { readSessionCookie, setSessionCookie, clearSessionCookie } from "./cookie";
import { listUsers, createUser, updateUser } from "./adminUsers";
import { createAssignment, updateAssignment, listAssignments } from "./adminAssignments";
import { getPermissionMatrix, putPermissionMatrix } from "./adminPermissions";
import { AppError } from "../authz/types";

const CODE_TO_STATUS: Record<string, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
};

function fail(res: import("express").Response, e: unknown) {
  if (e instanceof AppError) {
    res.status(CODE_TO_STATUS[e.code] ?? 400).json({ errors: [{ code: e.code, message: e.message, field: e.field }] });
    return;
  }
  res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error)?.message ?? e) }] });
}

/** Express adapter for auth + admin (identity-access.md API). Handlers stay Express-free. */
export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { token, expiresAt, actor } = await login(req.body ?? {}, { ip: req.ip, userAgent: req.headers["user-agent"] });
      setSessionCookie(res, token, expiresAt);
      res.json({ data: { actor } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/auth/logout", async (req: AuthedRequest, res) => {
    const token = readSessionCookie(req);
    if (token) await logout(token, req.actor ?? null);
    clearSessionCookie(res);
    res.json({ data: { ok: true } });
  });

  app.get("/api/auth/me", requireSession, async (req: AuthedRequest, res) => {
    res.json({ data: await me({ actor: req.actor! }) });
  });

  app.post("/api/auth/reset/request", async (req, res) => {
    try {
      await requestPasswordReset(req.body ?? {});
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/auth/reset/complete", async (req, res) => {
    try {
      await completePasswordReset(req.body ?? {});
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/auth/invite/accept", async (req, res) => {
    try {
      const { token, expiresAt, actor } = await acceptInvite(req.body ?? {}, { ip: req.ip, userAgent: req.headers["user-agent"] });
      setSessionCookie(res, token, expiresAt);
      res.json({ data: { actor } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/admin/users", requireSession, async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listUsers({ actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/admin/users", requireSession, async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await createUser(req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/api/admin/users/:id", requireSession, async (req: AuthedRequest, res) => {
    try {
      await updateUser(req.params.id, req.body ?? {}, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/admin/assignments", requireSession, async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await listAssignments({ actor: req.actor! }, req.query.project_id as string | undefined) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/admin/assignments", requireSession, async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await createAssignment(req.body ?? {}, { actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/api/admin/assignments/:id", requireSession, async (req: AuthedRequest, res) => {
    try {
      await updateAssignment(req.params.id, req.body ?? {}, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/admin/permission-matrix", requireSession, async (req: AuthedRequest, res) => {
    try {
      res.json({ data: await getPermissionMatrix({ actor: req.actor! }) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.put("/api/admin/permission-matrix", requireSession, async (req: AuthedRequest, res) => {
    try {
      await putPermissionMatrix(req.body ?? {}, { actor: req.actor! });
      res.json({ data: { ok: true } });
    } catch (e) {
      fail(res, e);
    }
  });
}
