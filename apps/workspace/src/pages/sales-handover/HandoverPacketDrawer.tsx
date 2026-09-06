import { useEffect, useState } from "react";
import { Drawer, DrawerContent, Skeleton, EmptyState } from "@homeflow/ui";
import { CircleAlert } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesHandoverApi, type SalesHandover } from "./api";
import { HandoverStatusChip } from "./HandoverStatusChip";
import { HandoverEditForm } from "./HandoverEditForm";
import { HandoverReviewPanel } from "./HandoverReviewPanel";

/** 17-sales-crm-handover.md Screens: the one packet drawer, shared between the Sales-side edit
 *  flow (DRAFT/RETURNED) and the CRM-side review flow (SUBMITTED/ACCEPTED) — status alone picks
 *  the body, same as CommitmentDrawer picks its actions from `status`. Additive: does not touch
 *  CrmQueue.tsx's existing "Acceptance queue" (old bookings-crm.ts accept/return flow) or
 *  Workspace.tsx's booking→CRM routing — visual.spec.ts's "Booking → CRM handoff" test depends on
 *  that exact pre-existing path. */
export function HandoverPacketDrawer({ bookingId, onClose, onChanged }: { bookingId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [h, setH] = useState<SalesHandover | null>(null);
  const [error, setError] = useState(false);

  function load() {
    if (!bookingId) return;
    setError(false);
    salesHandoverApi
      .get(bookingId)
      .catch(async (e) => {
        // `submit` doubles as "create the packet" (routes-sales-handover.ts header comment) —
        // no packet exists yet for this booking, so bootstrap one. An empty first submit is
        // expected to come back gate_blocked (nothing confirmed yet); core.ts persists the
        // DRAFT row before it throws, so the packet exists once this resolves either way.
        if (e instanceof ApiError && e.code === "not_found") {
          await salesHandoverApi.submit(bookingId, {}).catch(() => undefined);
          return salesHandoverApi.get(bookingId);
        }
        throw e;
      })
      .then(setH)
      .catch(() => setError(true));
  }

  useEffect(() => {
    setH(null);
    if (bookingId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  function handleChanged() {
    load();
    onChanged?.();
  }

  return (
    <Drawer
      open={bookingId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent open={bookingId !== null} title={h ? (h.packet.customer_section.display_name ?? h.booking_id) : "Handover packet"} width={640}>
        <div className="p-6">
          {error ? (
            <EmptyState icon={CircleAlert} message="Couldn't load this handover packet." action={{ label: "Retry", onClick: load }} />
          ) : h === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <HandoverStatusChip status={h.status} className="w-fit" />
              {h.status === "DRAFT" || h.status === "RETURNED" ? (
                <HandoverEditForm h={h} onChanged={handleChanged} />
              ) : (
                <HandoverReviewPanel h={h} onChanged={handleChanged} />
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
