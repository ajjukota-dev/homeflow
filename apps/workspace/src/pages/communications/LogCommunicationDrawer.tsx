// 29-communications.md Screens: "Log a call/meeting" — rule 1's manual log path. Channel is
// restricted to non-EMAIL values here; email always goes through SendEmailDrawer's own guardrail
// + template flow, never this generic path (rule 5 requires the frequency check EMAIL always gets).
import { useState } from "react";
import { Drawer, DrawerContent, Button, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Segmented, Checkbox } from "@homeflow/ui";
import { communicationsApi, CHANNEL_LABEL, type Channel } from "./api";

const LOGGABLE_CHANNELS: Channel[] = ["CALL", "MEETING", "WHATSAPP", "SMS", "NOTICE"];

function blank() {
  return { channel: "CALL" as Channel, direction: "OUTBOUND" as "INBOUND" | "OUTBOUND", subject: "", body: "", follow_up_required: false };
}

export function LogCommunicationDrawer({
  open, onOpenChange, customerId, bookingId, onLogged,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; customerId: string; bookingId?: string | null; onLogged: () => void;
}) {
  const [draft, setDraft] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDraft(blank());
    setError(null);
  }

  async function submit() {
    if (!draft.body.trim()) { setError("Add what was discussed."); return; }
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.log({
        customer_id: customerId,
        booking_id: bookingId ?? undefined,
        channel: draft.channel,
        direction: draft.direction,
        subject: draft.subject.trim() || undefined,
        body: draft.body.trim(),
        follow_up_required: draft.direction === "INBOUND" ? draft.follow_up_required : undefined,
      });
      reset();
      onLogged();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DrawerContent open={open} title="Log a call or meeting" width={480}>
        <div className="flex flex-col gap-4">
          <Field label="Channel" htmlFor="log-channel">
            <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v as Channel })}>
              <SelectTrigger id="log-channel" />
              <SelectOptions options={LOGGABLE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
            </Select>
          </Field>
          <Field label="Direction" htmlFor="log-direction">
            <Segmented
              aria-label="Direction"
              value={draft.direction}
              onChange={(v) => setDraft({ ...draft, direction: v as "INBOUND" | "OUTBOUND" })}
              options={[{ value: "OUTBOUND", label: "We reached out" }, { value: "INBOUND", label: "Customer reached out" }]}
            />
          </Field>
          <Field label="Subject" htmlFor="log-subject" hint="Optional">
            <Input id="log-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </Field>
          <Field label="What was discussed" htmlFor="log-body" required>
            <Textarea id="log-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} />
          </Field>
          {draft.direction === "INBOUND" && (
            <Checkbox
              label="Needs a follow-up — creates a CRM task with a response-time clock"
              checked={draft.follow_up_required}
              onCheckedChange={(c) => setDraft({ ...draft, follow_up_required: !!c })}
            />
          )}
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy}>{busy ? "Logging…" : "Log it"}</Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
