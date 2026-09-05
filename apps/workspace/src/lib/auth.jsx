/**
 * `useAuth()` — a thin adapter over `useSession()` from @homeflow/ui.
 *
 * v1 kept a JWT in localStorage, refreshed it on 401 and asked `/auth/me` who
 * it was. All three are gone (technical/03): the browser holds an opaque
 * `hf_session` cookie, the server answers `GET /me/session`, and signing out is
 * a POST the server can honour by revoking the row.
 *
 * ponytail: `user` is still shaped the way v1's 34 consumers expect
 * (`user.role.code`, `user.role.is_super_admin`, `user.id`). The shape comes
 * from `/api/me/permissions`, which the RBAC matrix already served. Each ported
 * page reads `useSession()` directly and drops one consumer of this shim.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "@homeflow/ui";

import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { state, reload, signOut } = useSession();
  // undefined = loading, null = anonymous, object = signed in
  const [permissions, setPermissions] = useState(undefined);

  const loadPermissions = useCallback(async () => {
    try {
      const { data } = await api.get("/me/permissions");
      setPermissions(data);
    } catch {
      setPermissions(null);
    }
  }, []);

  useEffect(() => {
    if (state.status === "authenticated") {
      void loadPermissions();
    } else if (state.status === "anonymous") {
      setPermissions(null);
    }
  }, [state.status, loadPermissions]);

  const user = useMemo(() => {
    if (state.status === "loading" || (state.status === "authenticated" && permissions === undefined)) return undefined;
    if (state.status !== "authenticated") return null;
    const roleCode = permissions?.role_code || (state.session.role_ids[0] ?? "").toUpperCase();
    return {
      id: permissions?.user_id ?? null,
      name: state.session.display_name,
      role: {
        code: roleCode,
        name: permissions?.role || roleCode,
        is_super_admin: Boolean(permissions?.is_super_admin) || state.session.role_ids.includes("super_admin"),
      },
      department_id: permissions?.department_id ?? null,
      assigned_project_ids: permissions?.assigned_project_ids ?? state.session.project_ids,
      all_projects: state.session.all_projects,
    };
  }, [state, permissions]);

  const logout = useCallback(async () => {
    await signOut();
    setPermissions(null);
  }, [signOut]);

  const refreshMe = useCallback(async () => {
    await reload();
    await loadPermissions();
  }, [reload, loadPermissions]);

  const value = useMemo(
    () => ({ user, permissions, logout, refreshMe }),
    [user, permissions, logout, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function hasRole(user, ...codes) {
  if (!user) return false;
  if (user?.role?.is_super_admin) return true;
  return codes.includes(user?.role?.code);
}

export function isSuperAdmin(user) {
  return Boolean(user?.role?.is_super_admin);
}
