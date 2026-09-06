import { useCallback, useState } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDateTime } from "../lib/utils";

/** 26-customer-portal.md rule 6: appointment slots confirm/reschedule, checklist summary after
 *  completion, possession letter. */
export function Handover({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.handover(), []));
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    try {
      await portalApi.confirmHandoverAppointment(selected);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!selected || !reason.trim()) return;
    setBusy(true);
    try {
      await portalApi.rescheduleHandoverAppointment(selected, reason.trim());
      setRescheduling(false);
      setReason("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AreaScreen title="Handover" onBack={onBack} loading={loading} error={error} onRetry={reload} empty={!data}>
      {data && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <p className="text-body font-semibold">{data.status}</p>
            {data.confirmed_slot && <p className="mt-1 text-footnote text-fg-muted">Confirmed for {formatDateTime(data.confirmed_slot)}</p>}
            {data.possession_letter_ready && <p className="mt-2 text-footnote font-medium text-ontrack">Possession letter ready</p>}
          </div>

          {data.checklist_summary.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
              {data.checklist_summary.map((g) => (
                <div key={g.group} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                  <span className="text-body">{g.group}</span>
                  <span className="text-footnote text-fg-muted">
                    {g.done}/{g.total} done
                  </span>
                </div>
              ))}
            </div>
          )}

          {!data.confirmed_slot && data.proposed_slots.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-body font-semibold">Pick a handover slot</p>
              <div className="mt-3 flex flex-col gap-2">
                {data.proposed_slots.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelected(s)}
                    className={`rounded-lg border px-3 py-2 text-left text-body ${selected === s ? "border-accent bg-accent/10" : "border-line"}`}
                  >
                    {formatDateTime(s)}
                  </button>
                ))}
              </div>
              {!rescheduling ? (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={confirm}
                    disabled={!selected || busy}
                    className="flex-1 rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
                  >
                    {busy ? "Confirming…" : "Confirm"}
                  </button>
                  <button onClick={() => setRescheduling(true)} className="flex-1 rounded-full border border-line px-4 py-2.5 text-body font-medium">
                    Reschedule
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why doesn't this slot work?"
                    className="rounded-lg border border-line bg-surface p-3 text-body"
                    rows={2}
                  />
                  <button
                    onClick={reschedule}
                    disabled={!selected || !reason.trim() || busy}
                    className="rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
                  >
                    {busy ? "Sending…" : "Send reschedule request"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </AreaScreen>
  );
}
