import cors from "cors";

// Local Vite apps. Production must name its frontends in ALLOWED_ORIGINS.
// An empty production list allows nothing — never reflect the request origin.
const LOCAL_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

export function isCredentialedOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!origin) return false;
  const allowed = new Set<string>();
  if (env.NODE_ENV === "production") {
    for (const entry of (env.ALLOWED_ORIGINS ?? "").split(",")) {
      const trimmed = entry.trim();
      if (trimmed) allowed.add(trimmed);
    }
  } else {
    for (const local of LOCAL_DEV_ORIGINS) allowed.add(local);
  }
  return allowed.has(origin);
}

/** Credentialed CORS only for an allow-listed Origin. Unknown origins get no ACAO header. */
export function apiCors(env: NodeJS.ProcessEnv = process.env) {
  return cors({
    origin(origin, callback) {
      callback(null, isCredentialedOriginAllowed(origin, env));
    },
    credentials: true,
  });
}
