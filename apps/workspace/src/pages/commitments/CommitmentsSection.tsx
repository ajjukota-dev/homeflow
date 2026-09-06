import { useEffect, useState } from "react";
import { Button, Card, CardBody, Badge, Skeleton } from "@homeflow/ui";
import { Plus } from "lucide-react";
import { commitmentsApi, type Commitment } from "./api";
import { CommitmentDrawer } from "./CommitmentDrawer";
import { CommitmentStatusChip } from "./CommitmentStatusChip";
import { CreateCommitmentDialog } from "./CreateCommitmentDialog";
import { commitmentCategoryLabel } from "../../lib/labels";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** 13-promise-ledger.md Screens: "Booking 360 / Customer 360 → Commitments tab (same component)."
 *  Reuses the same CommitmentDrawer as the standalone Promise Ledger; this is the booking-scoped
 *  embed, so it also owns the one "New commitment" affordance (Promise Ledger's own table has none
 *  — see that file's header comment). */
export function CommitmentsSection({ bookingId, canWrite }: { bookingId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Commitment[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function load() {
    setError(false);
    commitmentsApi.forBooking(bookingId).then(setRows).catch(() => setError(true));
  }
  useEffect(() => {
    setRows(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-title3 font-semibold">Commitments</h2>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New commitment
          </Button>
        )}
      </div>

      {error && <p className="text-footnote text-danger">Couldn't load commitments for this booking.</p>}
      {!error && rows === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && rows && rows.length === 0 && <p className="text-footnote text-fg-muted">No commitments recorded on this booking yet.</p>}
      {!error && rows && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((c) => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="w-full text-left">
              <Card>
                {/* flex-col by default: a `flex-1` title can't truncate correctly while sharing a
                    row with fixed-width badges (it just shrinks to near-0 instead of wrapping) —
                    same fix LegalFactory.tsx's row already uses. */}
                <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-headline font-semibold">{c.description}</div>
                    <div className="text-footnote text-fg-muted">
                      {c.code} · {commitmentCategoryLabel(c.category)} · Due {fmtDate(c.due_date)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.customer_facing && <Badge>Customer-facing</Badge>}
                    <CommitmentStatusChip status={c.status} />
                  </div>
                </CardBody>
              </Card>
            </button>
          ))}
        </div>
      )}

      <CommitmentDrawer commitmentId={openId} onClose={() => setOpenId(null)} onChanged={load} />
      {creating && (
        <CreateCommitmentDialog
          bookingId={bookingId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}
