import { useEffect, useState, useCallback } from "react";
import { Bell, Send } from "lucide-react";
import { Card, CardBody, Skeleton, EmptyState, Button, Textarea, Field, Badge } from "@homeflow/ui";
import { api, type Booking } from "../../api";
import { customerUpdatesApi, type CustomerUpdateRow } from "./api";

interface DraftRow {
  booking: Booking;
  update: CustomerUpdateRow;
}

/** 26-customer-portal.md Screens: "CRM → Customer updates queue (drafts from events, edit,
 *  publish)". Rule 10: the system only ever DRAFTs an update from an event — a human always
 *  reviews and publishes (never auto-sent, never AI-sent). No bulk "drafts across all bookings"
 *  endpoint exists (customer-updates are fetched per booking_id) — this fetches every real
 *  booking and its updates, same N+1 scale as the rest of this demo dataset (~10 bookings). */
export function CustomerUpdates() {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState(false);
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    setDrafts(null);
    api
      .listBookings()
      .then(async (bookings) => {
        const rows: DraftRow[] = [];
        for (const booking of bookings) {
          const updates = await customerUpdatesApi.forBooking(booking.id).catch(() => []);
          for (const update of updates) {
            if (update.status === "DRAFT") rows.push({ booking, update });
          }
        }
        setDrafts(rows);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  async function publish(row: DraftRow) {
    setBusyId(row.update.id);
    try {
      const edit = edits[row.update.id];
      await customerUpdatesApi.publish(row.update.id, edit);
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Customer updates</h1>
        <p className="mt-1 text-subhead text-fg-muted">
          Review draft updates before they reach the customer's portal — edit if needed, then publish.
        </p>
      </header>

      {error && <EmptyState icon={Bell} message="Couldn't load customer updates." action={{ label: "Retry", onClick: load }} />}
      {!error && drafts === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && drafts && drafts.length === 0 && <EmptyState icon={Bell} message="No draft updates waiting for review." />}
      {!error && drafts && drafts.length > 0 && (
        <div className="flex flex-col gap-3">
          {drafts.map((row) => {
            const edit = edits[row.update.id] ?? { title: row.update.title, body: row.update.body };
            return (
              <Card key={row.update.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-footnote text-fg-muted">
                        {row.booking.applicant_name ?? "—"} · Villa {row.booking.unit_number}
                      </p>
                    </div>
                    <Badge tone="neutral">{row.update.kind}</Badge>
                  </div>
                  <Field label="Title" htmlFor={`title-${row.update.id}`}>
                    <input
                      id={`title-${row.update.id}`}
                      value={edit.title}
                      onChange={(e) => setEdits((s) => ({ ...s, [row.update.id]: { ...edit, title: e.target.value } }))}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-body"
                    />
                  </Field>
                  <Field label="Message" htmlFor={`body-${row.update.id}`}>
                    <Textarea
                      id={`body-${row.update.id}`}
                      value={edit.body}
                      onChange={(e) => setEdits((s) => ({ ...s, [row.update.id]: { ...edit, body: e.target.value } }))}
                      rows={3}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button onClick={() => publish(row)} loading={busyId === row.update.id}>
                      <Send className="h-4 w-4" /> Publish to portal
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
