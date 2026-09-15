// 29-communications.md Screens: "Send email (template picker + preview + guardrail check)" —
// rule 5. Template mode resolves merge fields against the booking (if one is open) and shows the
// frequency guardrail's exact last-sent facts before the customer ever sees anything (rule 4)
// rather than a bare disabled button. Rule 8: sending is always this explicit click — nothing here
// fires on its own.
import { useEffect, useState } from "react";
import { TriangleAlert, ShieldAlert } from "lucide-react";
import { Drawer, DrawerContent, Button, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Segmented } from "@homeflow/ui";
import { communicationsApi, CHANNEL_LABEL, PURPOSE_LABEL, type CommunicationTemplateRow, type GuardrailStatus } from "./api";

const OVERRIDE_ROLES = ["CRM", "MANAGEMENT", "SUPER_ADMIN"];

export function SendEmailDrawer({
  open, onOpenChange, customerId, bookingId, defaultTo, roles, onSent,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; customerId: string; bookingId?: string | null; defaultTo?: string | null; roles: string[]; onSent: () => void;
}) {
  const [mode, setMode] = useState<"template" | "freeform">("template");
  const [templates, setTemplates] = useState<CommunicationTemplateRow[] | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [preview, setPreview] = useState<{ subject: string; body: string; unresolved: string[] } | null>(null);
  const [guardrail, setGuardrail] = useState<GuardrailStatus | null>(null);
  const [to, setTo] = useState(defaultTo ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOverride = roles.some((r) => OVERRIDE_ROLES.includes(r));

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo ?? "");
    communicationsApi.templates({ channel: "EMAIL" }).then((t) => setTemplates(t.filter((x) => x.status === "APPROVED"))).catch(() => setTemplates([]));
  }, [open, defaultTo]);

  useEffect(() => {
    if (!templateId) { setPreview(null); setGuardrail(null); return; }
    communicationsApi.previewTemplate(templateId, bookingId).then(setPreview).catch(() => setPreview(null));
    communicationsApi.guardrailStatus(customerId, templateId).then(setGuardrail).catch(() => setGuardrail(null));
  }, [templateId, customerId, bookingId]);

  function reset() {
    setMode("template");
    setTemplateId("");
    setPreview(null);
    setGuardrail(null);
    setSubject("");
    setBody("");
    setOverrideReason("");
    setError(null);
  }

  async function submit() {
    if (!to.trim()) { setError("Add the customer's email address."); return; }
    if (mode === "template" && !templateId) { setError("Pick a template."); return; }
    if (mode === "freeform" && !body.trim()) { setError("Write the message."); return; }
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.sendEmail({
        customer_id: customerId,
        booking_id: bookingId ?? undefined,
        to: to.trim(),
        template_id: mode === "template" ? templateId : undefined,
        subject: mode === "freeform" ? subject.trim() : undefined,
        body: mode === "freeform" ? body.trim() : undefined,
        override_reason: guardrail?.reason === "frequency" ? overrideReason.trim() || undefined : undefined,
      });
      reset();
      onSent();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  const quietBlocked = guardrail?.reason === "quiet_hours";
  const freqBlocked = guardrail?.blocked && guardrail.reason !== "quiet_hours";
  const blockedAndNoOverride = quietBlocked || (freqBlocked && (!canOverride || !overrideReason.trim()));

  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DrawerContent open={open} title="Send email" width={640}>
        <div className="flex flex-col gap-4">
          <Field label="To" htmlFor="send-to" required>
            <Input id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>

          <Segmented
            aria-label="Compose mode"
            value={mode}
            onChange={(v) => setMode(v as "template" | "freeform")}
            options={[{ value: "template", label: "Use a template" }, { value: "freeform", label: "Write freeform" }]}
          />

          {mode === "template" && (
            <>
              <Field label="Template" htmlFor="send-template" required hint={templates?.length === 0 ? "No approved email templates yet — ask a template owner to approve one in Policy Studio." : undefined}>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger id="send-template" placeholder="Choose a template" />
                  <SelectOptions options={(templates ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${PURPOSE_LABEL[t.purpose]} (${CHANNEL_LABEL[t.channel]})` }))} />
                </Select>
              </Field>

              {preview && (
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">Preview</p>
                  {preview.subject && <p className="mt-1 text-footnote font-semibold text-fg">{preview.subject}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-footnote text-fg-muted">{preview.body}</p>
                  {preview.unresolved.length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-caption text-atrisk">
                      <TriangleAlert className="h-3.5 w-3.5" /> Unresolved merge fields: {preview.unresolved.join(", ")}
                      {!bookingId && " — pick a booking to resolve these"}
                    </p>
                  )}
                </div>
              )}

              {quietBlocked && (
                <div className="rounded-lg border border-atrisk bg-atrisk/10 p-3">
                  <p className="flex items-center gap-1.5 text-footnote font-semibold text-atrisk">
                    <ShieldAlert className="h-4 w-4" /> Quiet hours — outbound email is blocked
                  </p>
                  <p className="mt-1 text-footnote text-fg-muted">
                    Sends are closed between {guardrail?.quiet_hours_start ?? "21:00"} and {guardrail?.quiet_hours_end ?? "08:00"} IST. This cannot be overridden.
                  </p>
                </div>
              )}

              {freqBlocked && (
                <div className="rounded-lg border border-atrisk bg-atrisk/10 p-3">
                  <p className="flex items-center gap-1.5 text-footnote font-semibold text-atrisk">
                    <ShieldAlert className="h-4 w-4" /> Frequency guardrail blocked
                  </p>
                  <p className="mt-1 text-footnote text-fg-muted">
                    Already sent {guardrail?.sent} of {guardrail?.max} allowed in the last {guardrail?.window_days} days for {guardrail?.purpose ? PURPOSE_LABEL[guardrail.purpose as keyof typeof PURPOSE_LABEL] ?? guardrail.purpose : "this purpose"}.
                  </p>
                  {canOverride ? (
                    <Field label="Override reason" htmlFor="override-reason" required hint="Required to send anyway.">
                      <Textarea id="override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} />
                    </Field>
                  ) : (
                    <p className="mt-1 text-caption text-fg-subtle">Only CRM, Management or a Super Admin can override this.</p>
                  )}
                </div>
              )}
            </>
          )}

          {mode === "freeform" && (
            <>
              <Field label="Subject" htmlFor="send-subject">
                <Input id="send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Message" htmlFor="send-body" required>
                <Textarea id="send-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
              </Field>
            </>
          )}

          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy || !!blockedAndNoOverride}>{busy ? "Sending…" : "Send"}</Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
