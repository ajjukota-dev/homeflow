import { Navigate, useLocation } from "react-router-dom";
import { StaffSignIn } from "@homeflow/ui";

import { useAuth } from "@/lib/auth";

/**
 * Workspace sign-in (technical/03 §1, 09 §4).
 *
 * v1's screen had an email + password form and a "Continue with Google" button
 * that left for `auth.emergentagent.com` — a third party in the trust path and
 * a password hash to leak. Both are gone. The only route out of this page is
 * `/auth/google/start`, which HomeFlow's own API owns end to end.
 *
 * `VITE_DEV_LOGIN=1` adds the seeded staff list for local work; the API refuses
 * that route unless it is running with ENV=local.
 */
export default function LoginPage() {
  const { user } = useAuth();
  const location = useLocation();
  const from = location.state?.from || "/dashboard";

  if (user) return <Navigate to={from} replace />;
  return <StaffSignIn next={from} devLogin={import.meta.env.VITE_DEV_LOGIN === "1"} />;
}
