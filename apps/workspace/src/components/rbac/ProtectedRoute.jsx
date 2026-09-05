import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useCan, useHasProjectScope, usePermissions } from "@/context/PermissionsContext";

/**
 * MatrixProtectedRoute — route-level guard driven by /api/me/permissions.
 *
 * Wraps a route with { module, action }. If forbidden, silently redirects to
 * /dashboard (no toast — the sidebar already hides the item; a 403 here means
 * direct URL navigation to a restricted route). If the user has zero project
 * assignments and is not an all-projects role, shows a "No project assigned"
 * empty state instead.
 */
export default function MatrixProtectedRoute({ module, action = "read", children }) {
  const { perms, loading } = usePermissions();
  const allowed = useCan(module, action);
  const hasScope = useHasProjectScope();
  const location = useLocation();

  useEffect(() => {
    if (loading || allowed) return;
    // eslint-disable-next-line no-console
    console.debug("[rbac] route denied", { module, action, path: location.pathname });
  }, [loading, allowed, module, action, location.pathname]);

  if (loading || perms === undefined) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-gray-500" data-testid="rbac-loading">
        Checking access…
      </div>
    );
  }

  if (!hasScope) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-6" data-testid="no-project-scope">
        <div className="text-lg font-semibold text-gray-900 mb-2">No project assigned</div>
        <p className="text-sm text-gray-500 max-w-md">
          Your account is active but you haven't been assigned to any project yet.
          Please contact your Pranava admin to receive an assignment.
        </p>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace state={{ from: location.pathname }} />;
  }

  return children;
}
