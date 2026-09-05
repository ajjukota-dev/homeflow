// 00-conventions.md: ctx.actor = { user_id, roles[], project_ids[] | 'ALL', display_name }.
export interface Actor {
  user_id: string;
  display_name: string;
  kind: "STAFF" | "CUSTOMER";
  roles: string[];
  project_ids: string[] | "ALL";
  default_project_id: string | null;
}

// Handlers are Express-free: (input, ctx) => result. Ports beyond `actor` (db,
// events, mailer, ...) land as other specs build them; identity only needs actor.
export interface Ctx {
  actor: Actor;
}

// `unauthenticated` (401) is transport-level (no/invalid session) — 00-conventions.md's
// error table doesn't name it because it's outside handler logic (requireSession only).
export type AppErrorCode = "validation" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "unauthenticated";

export class AppError extends Error {
  code: AppErrorCode;
  field?: string;
  constructor(code: AppErrorCode, message: string, field?: string) {
    super(message);
    this.code = code;
    this.field = field;
  }
}
