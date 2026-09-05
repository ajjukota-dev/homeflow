import { useLocation, Link } from "react-router-dom";
import { Clock, ArrowLeft } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";

export default function ComingSoon() {
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find((n) => pathname.startsWith(n.to)) || {};
  return (
    <div className="space-y-6" data-testid="coming-soon">
      <PageHeader
        title={item.label || "Coming soon"}
        subtitle={item.subLabel || "This section is scoped for a later phase."}
      />
      <div className="rounded-md border border-gray-200 bg-white p-10 flex flex-col items-center text-center">
        <div className="h-12 w-12 rounded-full bg-brand-50 text-navy-900 flex items-center justify-center mb-4">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="font-heading text-lg font-semibold text-gray-900">Coming in a later phase</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-md">
          Phase 1 delivers the foundation: authentication, RBAC, master data (users, departments, projects, units, customers, bookings), global search and audit logs. This module will be built in a subsequent phase.
        </p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-navy-900 hover:underline"
          data-testid="coming-soon-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
