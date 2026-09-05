import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi, type Me } from "./api";

interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  me: Me | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Session bootstrap (GET /auth/me) for the whole workspace — rule 9's default project, header user menu. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await authApi.me();
      setMe(result);
      setStatus("authenticated");
    } catch {
      setMe(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setMe(null);
    setStatus("unauthenticated");
  }, []);

  return <AuthContext.Provider value={{ status, me, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
