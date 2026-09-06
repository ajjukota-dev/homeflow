import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Route } from "lucide-react";
import { api, type Customer } from "../api";
import { Card, CardBody, Button } from "@homeflow/ui";
import { MoneyFigure } from "../ui/MoneyFigure";
import { cn } from "../lib/utils";
import { bookingStatusLabel, kycStatusLabel } from "../lib/labels";
import { ActivityFeed } from "../components/ActivityFeed";
import { JourneyTimeline } from "./journey/JourneyTimeline";
import { CommitmentsSection } from "./commitments/CommitmentsSection";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const statusTone: Record<string, string> = {
  active: "text-ontrack bg-ontrack/10",
  submitted: "text-due bg-due/10",
  returned: "text-overdue bg-overdue/10",
};

export function Customer360({ customerId, onBack, roles }: { customerId: string; onBack: () => void; roles: string[] }) {
  // createCommitment (commitments/core.ts) gates on plain matrix WRITE with no MANAGEMENT
  // override (unlike approve/waive) — matrix (seed/permissions.ts) grants WRITE to CRM only.
  // MANAGEMENT would see this button, submit, and get a 403.
  const canWriteCommitments = roles.includes("CRM") || roles.includes("SUPER_ADMIN");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewingBookingId, setViewingBookingId] = useState<string | null>(null);

  useEffect(() => {
    api.getCustomer(customerId).then(setCustomer).finally(() => setLoading(false));
  }, [customerId]);

  if (viewingBookingId) {
    return <JourneyTimeline bookingId={viewingBookingId} onBack={() => setViewingBookingId(null)} />;
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </button>

      {loading && <div className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" />}

      {!loading && customer && (
        <>
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-title2 font-semibold text-fg-muted">
              {initials(customer.display_name)}
            </div>
            <div>
              <h1 className="text-large font-bold">{customer.display_name}</h1>
              <p className="text-subhead text-fg-muted">{customer.primary_phone}</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ontrack/10 px-3 py-1 text-footnote font-medium text-ontrack">
              <ShieldCheck className="h-3.5 w-3.5" /> KYC {kycStatusLabel(customer.kyc_status)}
            </span>
          </div>

          <h2 className="mb-3 text-title3 font-semibold">Bookings</h2>
          <div className="flex flex-col gap-3">
            {customer.bookings.map((b) => (
              <Card key={b.booking_number}>
                <CardBody className="flex items-center gap-4">
                  <div>
                    <div className="text-headline font-semibold">Villa {b.unit_number}</div>
                    <div className="text-footnote text-fg-muted">
                      {b.unit_type} · {b.facing} facing · {b.booking_number}
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <MoneyFigure amount={b.total_consideration} />
                    <div className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-caption font-medium", statusTone[b.status])}>
                      {bookingStatusLabel(b.status)}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setViewingBookingId(b.booking_id)}>
                    <Route className="h-4 w-4" /> View journey
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>

          {customer.bookings.map((b) => (
            <div key={`commitments-${b.booking_id}`} className="mt-8">
              <CommitmentsSection bookingId={b.booking_id} canWrite={canWriteCommitments} />
            </div>
          ))}

          <h2 className="mb-3 mt-8 text-title3 font-semibold">Activity</h2>
          <ActivityFeed entityType="customer" entityId={customer.id} />
        </>
      )}
    </div>
  );
}
