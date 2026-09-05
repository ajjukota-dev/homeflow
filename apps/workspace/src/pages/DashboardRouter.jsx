import { useAuth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/collab";
import Dashboard from "@/pages/Dashboard";
import ExecDashboard from "@/pages/ExecDashboard";

/**
 * Dashboard router: Management + Super Admin see the Exec dashboard;
 * every other role sees the operational dashboard.
 */
export default function DashboardRouter() {
  const { user } = useAuth();
  if (!user) return null;
  if (isSuperAdmin(user) || user?.role?.code === "MANAGEMENT") {
    return <ExecDashboard />;
  }
  return <Dashboard />;
}
