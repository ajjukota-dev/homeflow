import type { Response } from "express";
import { AppError } from "./types";

// Same mapping as auth/routes.ts's CODE_TO_STATUS — extracted here (R0.6) since
// server.ts/routes-lifecycle.ts/routes-model.ts now throw AppError("forbidden"/
// "not_found") from authorize()/requireRole() and need the same status mapping.
const CODE_TO_STATUS: Record<string, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
};

export function failHttp(res: Response, e: unknown): void {
  if (e instanceof AppError) {
    res.status(CODE_TO_STATUS[e.code] ?? 400).json({ errors: [{ code: e.code, message: e.message, field: e.field }] });
    return;
  }
  res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error)?.message ?? e) }] });
}
