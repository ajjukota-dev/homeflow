import { createContext, useContext, useMemo } from "react";

import { useAuth } from "@/lib/auth";

/**
 * PermissionsContext — single source of truth for the matrix from
 * `GET /api/me/permissions`. Consumed by `<CanAccess>`, `<ProtectedRoute>`,
 * `<RestrictedField>` and the Layout sidebar.
 *
 * Changed for 2.0: the matrix is fetched once by `AuthProvider` (which now
 * knows when the session becomes valid) instead of a second time here off the
 * back of a localStorage token that no longer exists. The hooks below are
 * unchanged, so all 34 consumers keep working.
 */

// permission → integer rank (matches backend rbac_matrix._LEVEL_ORDER)
const LEVEL_RANK = {
  none: 0,
  read_status_only: 1,
  read_limited: 1,
  read: 1,
  write: 2,
  admin: 3,
};

const REQUIRED_RANK = { read: 1, write: 2, admin: 3 };

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const { permissions, refreshMe } = useAuth();

  const value = useMemo(() => {
    const perms =
      permissions === undefined
        ? undefined
        : permissions === null
          ? null
          : {
              role: permissions.role,
              roleCode: permissions.role_code,
              isSuperAdmin: Boolean(permissions.is_super_admin),
              assignedProjectIds: permissions.assigned_project_ids || [],
              modules: permissions.modules || {},
              redactions: permissions.redactions || {},
              journeyStageVisibility: permissions.journey_stage_visibility ?? null,
            };
    return { perms, loading: perms === undefined, error: null, refresh: refreshMe };
  }, [permissions, refreshMe]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used within PermissionsProvider");
  return ctx;
}

/**
 * useCan(module, action)  → boolean
 * action: 'read' | 'write' | 'admin' (default 'read')
 * Modifiers (read_status_only / read_limited) satisfy 'read'.
 */
export function useCan(module, action = "read") {
  const { perms } = usePermissions();
  if (!perms) return false;
  if (perms.isSuperAdmin) return true;
  const perm = perms.modules?.[module] || "none";
  const have = LEVEL_RANK[perm] ?? 0;
  const want = REQUIRED_RANK[action] ?? 1;
  return have >= want;
}

/**
 * usePermissionLevel(module) → raw permission string
 * Useful for `RestrictedField` to detect `read_status_only` / `read_limited`.
 */
export function usePermissionLevel(module) {
  const { perms } = usePermissions();
  if (!perms) return "none";
  if (perms.isSuperAdmin) return "admin";
  return perms.modules?.[module] || "none";
}

/**
 * useHasProjectScope() → boolean
 * True if the user has at least one assigned project OR is an all-projects role
 * (super admin / management). False = "no project assigned" empty state trigger.
 */
export function useHasProjectScope() {
  const { perms } = usePermissions();
  if (!perms) return true; // don't block during load
  if (perms.isSuperAdmin) return true;
  if ((perms.roleCode || "").toUpperCase() === "MANAGEMENT") return true;
  return (perms.assignedProjectIds || []).length > 0;
}
