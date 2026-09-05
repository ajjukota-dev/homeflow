/**
 * Hides navigation the principal cannot use (technical/09 §4). Authorisation is
 * the server's — this only avoids showing a door that will not open.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
import { hasRole, useSession } from "./session";

export interface RequireRoleProps {
  roles: readonly string[];
  children: ReactNode;
  /** Rendered instead of the default "not yours" panel. */
  fallback?: ReactNode;
}

export function RequireRole({ roles, children, fallback }: RequireRoleProps) {
  const { state } = useSession();
  const ok = state.status === "authenticated" && hasRole(state.session, roles);
  if (ok) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <EmptyState
          title="Not part of your role"
          body="This area belongs to another team. If you need it, ask an administrator to change your role."
        />
      )}
    </>
  );
}
