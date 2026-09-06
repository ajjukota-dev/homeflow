import { useEffect, useState } from "react";
import { FileText, ChevronRight } from "lucide-react";
import { Card, CardBody, Skeleton, EmptyState } from "@homeflow/ui";
import { api, type Booking } from "../../api";
import { MoneyFigure } from "../../ui/MoneyFigure";
import { HandoverPacketDrawer } from "./HandoverPacketDrawer";

/** 17-sales-crm-handover.md Screens: the Sales-side packet list — one entry point per booking to
 *  build/edit/review its handover packet. Additive alongside CrmQueue.tsx's own "Acceptance
 *  queue" (the pre-existing bookings-crm.ts accept/return flow, untouched by this spec) — this is
 *  the new, separate 17-specific path, reachable from its own nav entry. */
export function HandoverPackets() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    setError(false);
    api.listBookings().then(setBookings).catch(() => setError(true));
  }
  useEffect(load, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Handover Packets</h1>
        <p className="mt-1 text-subhead text-fg-muted">
          Build a customer's handover packet, check what's still missing, and submit it to CRM for review.
        </p>
      </header>

      {error && (
        <EmptyState icon={FileText} message="Couldn't load bookings." action={{ label: "Retry", onClick: load }} />
      )}
      {!error && bookings === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && bookings && bookings.length === 0 && (
        <EmptyState icon={FileText} message="No bookings yet — book a villa on the Sales screen first." />
      )}
      {!error && bookings && bookings.length > 0 && (
        <div className="flex flex-col gap-3">
          {bookings.map((b) => (
            <button key={b.id} onClick={() => setOpenId(b.id)} className="w-full text-left">
              <Card>
                <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-headline font-semibold">{b.applicant_name ?? "—"}</div>
                    <div className="text-footnote text-fg-muted">
                      Villa {b.unit_number} · {b.booking_number}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <MoneyFigure amount={b.total_consideration} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
                  </div>
                </CardBody>
              </Card>
            </button>
          ))}
        </div>
      )}

      <HandoverPacketDrawer bookingId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
