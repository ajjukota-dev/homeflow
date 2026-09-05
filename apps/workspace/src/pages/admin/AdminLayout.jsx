import { NavLink, Outlet } from "react-router-dom";
import PageHeader from "@/components/PageHeader";

const TABS = [
  { to: "/admin/users", label: "Users", key: "users" },
  { to: "/admin/roles", label: "Roles", key: "roles" },
  { to: "/admin/departments", label: "Departments", key: "departments" },
  { to: "/admin/projects", label: "Projects", key: "projects" },
  { to: "/admin/units", label: "Units", key: "units" },
  { to: "/admin/customers", label: "Customers", key: "customers" },
  { to: "/admin/bookings", label: "Bookings", key: "bookings" },
];

export default function AdminLayout() {
  return (
    <div className="space-y-6" data-testid="admin-layout">
      <PageHeader
        title="Administration"
        subtitle="Master data · Users, Roles, Departments, Projects, Units, Customers, Bookings."
      />

      <div className="border-b border-gray-200">
        <nav className="flex flex-wrap gap-x-1 -mb-px" data-testid="admin-tabs">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              data-testid={`admin-tab-${t.key}`}
              className={({ isActive }) =>
                [
                  "px-3 py-2 text-sm border-b-2 -mb-px",
                  isActive
                    ? "border-navy-900 text-navy-900 font-medium"
                    : "border-transparent text-gray-600 hover:text-gray-900",
                ].join(" ")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div>
        <Outlet />
      </div>
    </div>
  );
}
