import { useCallback, useEffect, useState } from "react";
import { Inbox, ChevronRight } from "lucide-react";
import { api, type Booking, type CustomerRow } from "../api";
import { Card, CardBody, Button } from "@homeflow/ui";
import { MoneyFigure } from "../ui/MoneyFigure";
import { Customer360 } from "./Customer360";

// Rule 7: the acceptance queue is sales_handover (NONE for CUSTOMISATION,
// which only has this page for its customer_overview/customer_journey READ —
// see nav.ts). No route enforces this server-side yet, so hide the section
// itself (not just its buttons) the same way nav.ts hides a whole tab.
const CAN_ACCEPT_BOOKINGS = new Set(["MANAGEMENT", "SALES", "CRM", "SUPER_ADMIN"]);

/** CRM / RM — booking acceptance gate (H2) + the Customer Twins it births. */
export function CrmQueue({ roles }: { roles: string[] }) {
  const canAccept = roles.some((r) => CAN_ACCEPT_BOOKINGS.has(r));
  const [queue, setQueue] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([api.listBookings("submitted"), api.listCustomers()])
      .then(([q, c]) => {
        setQueue(q);
        setCustomers(c);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function accept(id: string) {
    setBusy(id);
    await api.acceptBooking(id);
    await load();
    setBusy(null);
  }
  async function submitReturn(id: string) {
    if (!reason.trim()) return;
    setBusy(id);
    await api.returnBooking(id, reason.trim());
    setReturningId(null);
    setReason("");
    await load();
    setBusy(null);
  }

  if (selected) return <Customer360 customerId={selected} onBack={() => setSelected(null)} roles={roles} />;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">CRM · Relationship</h1>
        <p className="mt-1 text-subhead text-fg-muted">
          Accept booking files from Sales (the completeness gate) — accepting births a Customer 360.
        </p>
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}

      {canAccept && (
      <section className="mb-8">
        <h2 className="mb-3 text-title3 font-semibold">Acceptance queue</h2>
        {loading ? (
          <div className="h-28 animate-pulse rounded-xl border border-line bg-surface-2" />
        ) : queue.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-8 w-8 text-fg-subtle" />
              <p className="text-subhead text-fg-muted">
                No files waiting. Book a villa on the Sales screen to see it here.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((b) => (
              <Card key={b.id}>
                <CardBody>
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-headline font-semibold">{b.applicant_name}</div>
                      <div className="text-footnote text-fg-muted">
                        Villa {b.unit_number} · {b.booking_number} · {b.applicant_phone}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-4">
                      <MoneyFigure amount={b.total_consideration} />
                      <span className="rounded-full bg-ontrack/10 px-2.5 py-1 text-footnote font-medium text-ontrack">
                        {b.completeness_score}% complete
                      </span>
                      <Button size="sm" onClick={() => accept(b.id)} disabled={busy === b.id}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReturningId(returningId === b.id ? null : b.id)}
                        disabled={busy === b.id}
                      >
                        Return
                      </Button>
                    </div>
                  </div>
                  {returningId === b.id && (
                    <div className="mt-3 flex gap-2">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason for return…"
                        className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-body outline-none focus:border-accent"
                      />
                      <Button size="sm" variant="secondary" onClick={() => submitReturn(b.id)}>
                        Send back
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>
      )}

      <section>
        <h2 className="mb-3 text-title3 font-semibold">Active customers</h2>
        {loading ? null : customers.length === 0 ? (
          <p className="text-subhead text-fg-muted">No customers yet — accept a booking to create one.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {customers.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-2"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-footnote font-semibold text-fg-muted">
                  {c.display_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div>
                  <div className="text-headline font-semibold">{c.display_name}</div>
                  <div className="text-footnote text-fg-muted">
                    Villa {c.unit_number} · {c.booking_number}
                  </div>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 text-fg-subtle" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
