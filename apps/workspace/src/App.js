import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import "@/App.css";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PermissionsProvider } from "@/context/PermissionsContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import MatrixProtectedRoute from "@/components/rbac/ProtectedRoute";
import Layout from "@/components/Layout";
import LandingPage from "@/pages/Landing";
import LoginPage from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import DashboardRouter from "@/pages/DashboardRouter";
import ComingSoon from "@/pages/ComingSoon";
import CustomerDetail from "@/pages/CustomerDetail";
import UnitDetail from "@/pages/UnitDetail";
import BookingDetail from "@/pages/BookingDetail";
import ProjectDetail from "@/pages/ProjectDetail";
import NotificationsPage from "@/pages/Notifications";
import CustomerJourneys from "@/pages/CustomerJourneys";
import TasksActions from "@/pages/TasksActions";
import SalesHandoverList from "@/pages/SalesHandoverList";
import SalesHandoverPage from "@/pages/SalesHandoverPage";
import DocumentsList from "@/pages/DocumentsList";
import GenerateDocuments from "@/pages/GenerateDocuments";
import CommitmentsList from "@/pages/CommitmentsList";
import Collections from "@/pages/Collections";
import Loans from "@/pages/Loans";
import Legal from "@/pages/Legal";
import Registrations from "@/pages/Registrations";
import UnitReadiness from "@/pages/UnitReadiness";
import Snagging from "@/pages/Snagging";
import Handovers from "@/pages/Handovers";
import Communications from "@/pages/Communications";
import Escalations from "@/pages/Escalations";
import Reports from "@/pages/Reports";
import ExecDashboard from "@/pages/ExecDashboard";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminUsers from "@/pages/admin/Users";
import AdminRoles from "@/pages/admin/Roles";
import AdminDepartments from "@/pages/admin/Departments";
import AdminProjects from "@/pages/admin/Projects";
import AdminUnits from "@/pages/admin/Units";
import AdminCustomers from "@/pages/admin/Customers";
import AdminBookings from "@/pages/admin/Bookings";

// Small helper — wrap a module-gated page
const G = (module, action, el) => (
  <MatrixProtectedRoute module={module} action={action}>{el}</MatrixProtectedRoute>
);

// Public root: signed-out visitors see the marketing landing page; signed-in
// users bounce straight to the dashboard. Kept OUTSIDE the ProtectedRoute
// wrapper so unauthenticated hits never redirect to /login automatically.
function RootRoute() {
  const { user } = useAuth();
  if (user === undefined) {
    return (
      <div
        className="flex h-screen items-center justify-center text-sm text-gray-500"
        data-testid="root-loading"
      >
        Loading…
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

// Nav items that are placeholder ("Coming soon") in Phase 1
const PLACEHOLDER_PATHS = [];

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <Routes>
              <Route path="/" element={<RootRoute />} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<DashboardRouter />} />

                <Route path="/customers/:id" element={<CustomerDetail />} />
                <Route path="/units/:id" element={<UnitDetail />} />
                <Route path="/bookings/:id" element={<BookingDetail />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/tasks/mentions" element={<NotificationsPage />} />

                <Route path="/customer-journeys" element={G("customer_journey", "read", <CustomerJourneys />)} />
                <Route path="/tasks" element={G("customer_tasks", "read", <TasksActions />)} />
                <Route path="/sales-handover" element={G("sales_handover", "read", <SalesHandoverList />)} />
                <Route path="/sales-handover/:bookingId" element={G("sales_handover", "read", <SalesHandoverPage />)} />
                <Route path="/documents" element={G("documents", "read", <DocumentsList />)} />
                <Route path="/documents/generate" element={G("documents", "read", <GenerateDocuments />)} />
                <Route path="/commitments" element={G("commitments", "read", <CommitmentsList />)} />
                <Route path="/collections" element={G("collections", "read", <Collections />)} />
                <Route path="/loans" element={G("loans", "read", <Loans />)} />
                <Route path="/legal" element={G("legal", "read", <Legal />)} />
                <Route path="/registrations" element={G("registrations", "read", <Registrations />)} />
                <Route path="/unit-readiness" element={G("unit_readiness", "read", <UnitReadiness />)} />
                <Route path="/snagging" element={G("snagging", "read", <Snagging />)} />
                <Route path="/handovers" element={G("handovers", "read", <Handovers />)} />
                <Route path="/communications" element={G("communications", "read", <Communications />)} />
                <Route path="/escalations" element={G("escalations", "read", <Escalations />)} />
                <Route path="/reports" element={G("reports", "read", <Reports />)} />

                {PLACEHOLDER_PATHS.map((p) => (
                  <Route key={p} path={`${p}/*`} element={<ComingSoon />} />
                ))}

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requireSuperAdmin>
                      <MatrixProtectedRoute module="administration" action="admin">
                        <AdminLayout />
                      </MatrixProtectedRoute>
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/admin/users" replace />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="roles" element={<AdminRoles />} />
                  <Route path="departments" element={<AdminDepartments />} />
                  <Route path="projects" element={<AdminProjects />} />
                  <Route path="units" element={<AdminUnits />} />
                  <Route path="customers" element={<AdminCustomers />} />
                  <Route path="bookings" element={<AdminBookings />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </PermissionsProvider>
        </AuthProvider>
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </div>
  );
}
