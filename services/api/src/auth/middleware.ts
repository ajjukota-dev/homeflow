import type { NextFunction, Request, Response } from "express";
import { validateSessionToken } from "./session";
import { readSessionCookie } from "./cookie";
import type { Actor } from "../authz/types";

export interface AuthedRequest extends Request {
  actor?: Actor;
}

/** API rule: requireSession on every non-auth route; GET /health is public. */
export async function requireSession(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(req);
  const actor = token ? await validateSessionToken(token) : null;
  if (!actor) {
    res.status(401).json({ errors: [{ code: "unauthenticated" }] });
    return;
  }
  req.actor = actor;
  next();
}
