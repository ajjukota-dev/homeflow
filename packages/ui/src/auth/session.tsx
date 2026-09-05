/**
 * `useSession()` — one `GET /me/session` per page load (technical/09 §4).
 *
 * There is no token in JavaScript: the browser holds `hf_session`, the server
 * answers with the principal, and a 401 anywhere flips this store to
 * signed-out so `<SignInGate>` takes over (technical/03 §3).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, onUnauthenticated, ApiError } from "../api/client";
import { clearCache } from "../query/useQuery";

export type Realm = "staff" | "customer";

export interface Session {
  realm: Realm;
  display_name: string;
  role_ids: string[];
  project_ids: string[];
  all_projects: boolean;
}

export type SessionState =
  | { status: "loading"; session: null; error: null }
  | { status: "anonymous"; session: null; error: null }
  | { status: "error"; session: null; error: ApiError }
  | { status: "authenticated"; session: Session; error: null };

interface SessionContextValue {
  state: SessionState;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchSession(): Promise<Session> {
  return api.get("/me/session") as unknown as Promise<Session>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", session: null, error: null });

  const reload = useCallback(async () => {
    try {
      const session = await fetchSession();
      setState({ status: "authenticated", session, error: null });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) setState({ status: "anonymous", session: null, error: null });
      else setState({ status: "error", session: null, error: err });
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* the cookie is gone either way; the reload below settles the truth */
    }
    clearCache();
    await reload();
  }, [reload]);

  useEffect(() => {
    void reload();
    // A 401 from any other call means the session died mid-visit.
    return onUnauthenticated(() =>
      setState((prev) => (prev.status === "authenticated" ? { status: "anonymous", session: null, error: null } : prev)),
    );
  }, [reload]);

  const value = useMemo(() => ({ state, reload, signOut }), [state, reload, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** True when the principal holds any of `roles`; the server still decides. */
export function hasRole(session: Session | null, roles: readonly string[]): boolean {
  if (!session) return false;
  if (session.role_ids.includes("super_admin")) return true;
  return roles.some((r) => session.role_ids.includes(r));
}
