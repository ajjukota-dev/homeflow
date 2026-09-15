import type { NextFunction, Request, Response } from "express";
import { validateSessionToken } from "./session";
import { readSessionCookie } from "./cookie";
import type { Actor } from "../authz/types";
import { runAsSystem, enterActor, clearRlsStore } from "../db/rls-context";

export interface AuthedRequest extends Request {
  actor?: Actor;
}

/** API rule: requireSession on every non-auth route; GET /health is public. */
export async function requireSession(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(req);
  // Identity + project_ids resolution joins booking (RLS). Load the actor as system,
  // then enter the request store so every subsequent query is homeflow_app + GUCs.
  const actor = token ? await runAsSystem(() => validateSessionToken(token)) : null;
  if (!actor) {
    res.status(401).json({ errors: [{ code: "unauthenticated" }] });
    return;
  }
  req.actor = actor;
  enterActor(actor);
  const clear = () => clearRlsStore();
  res.on("finish", clear);
  res.on("close", clear);
  next();
}
