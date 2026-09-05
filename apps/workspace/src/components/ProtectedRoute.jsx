import { useAuth } from "@/lib/auth";
import { Navigate, useLocation } from "react-router-dom";

export default function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500" data-testid="protected-loading">
        Loading…
      </div>
    );
  }
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (requireSuperAdmin && !user?.role?.is_super_admin) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
