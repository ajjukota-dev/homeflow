// 29-communications.md Screens: "Communication templates: versions, approval workflow" — rule 3's
// DRAFT -> LEGAL_REVIEW -> APPROVED lifecycle. `canEdit` (this tab's registered role set) gates
// showing any action at all; the server enforces exactly who may approve which purpose (Legal for
// payment/delay purposes, CRM/Management otherwise) — same trust-the-server precedent as
// DocumentTemplatesStudio, since that split can't be expressed as one boolean here either.
import { useEffect, useState } from "react";
import { Mail, PenSquare } from "lucide-react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Badge } from "@homeflow/ui";
import { communicationsApi, CHANNEL_LABEL, PURPOSE_LABEL, TEMPLATE_STATUS_LABEL, type CommunicationTemplateRow, type Channel, type TemplatePurpose } from "../communications/api";

const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];
const PURPOSES = Object.keys(PURPOSE_LABEL) as TemplatePurpose[];
const LEGAL_BEARING: TemplatePurpose[] = ["PAYMENT_REMINDER", "DELAY_NOTICE"];

function blank() {
  return { code: "", channel: "EMAIL" as Channel, purpose: "GENERAL" as TemplatePurpose, subject: "", body: "" };
}

export function CommunicationTemplatesStudio({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<CommunicationTemplateRow[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    communicationsApi.templates().then(setTemplates).catch(() => setError(true));
  }
  useEffect(load, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setSaveError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!draft?.code.trim() || !draft.body.trim()) return;
    await run("create", () => communicationsApi.createTemplate({ ...draft, code: draft.code.trim().toUpperCase().replace(/\s+/g, "_"), subject: draft.subject.trim() || null }));
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Communication templates"
        description="Rule 3: send-email only offers APPROVED templates. Payment reminders and delay notices need Legal's approval; everything else needs CRM or Management."
        actions={canEdit && !draft ? <Button onClick={() => setDraft(blank())}>+ New template</Button> : undefined}
      />
      {error && <EmptyState icon={Mail} message="Couldn't load templates." action={{ label: "Retry", onClick: load }} />}
      {!error && templates === null && (
        <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>
      )}

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Code" htmlFor="ct-code" required hint="e.g. PAYMENT_REMINDER_1">
              <Input id="ct-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
            </Field>
            <Field label="Channel" htmlFor="ct-channel">
              <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v as Channel })}>
                <SelectTrigger id="ct-channel" />
                <SelectOptions options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} />
              </Select>
            </Field>
            <Field label="Purpose" htmlFor="ct-purpose" hint={LEGAL_BEARING.includes(draft.purpose) ? "Needs Legal approval" : undefined}>
              <Select value={draft.purpose} onValueChange={(v) => setDraft({ ...draft, purpose: v as TemplatePurpose })}>
                <SelectTrigger id="ct-purpose" />
                <SelectOptions options={PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))} />
              </Select>
            </Field>
          </div>
          <Field label="Subject" htmlFor="ct-subject" hint="Optional — email/notice only">
            <Input id="ct-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </Field>
          <Field label="Body" htmlFor="ct-body" required hint="Use {{merge.field.code}} slots — resolved from a booking when sent.">
            <Textarea id="ct-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={6} className="font-mono" />
          </Field>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create draft"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!error && templates !== null && templates.length === 0 && !draft && (
        <EmptyState icon={Mail} message="No communication templates configured yet." action={canEdit ? { label: "Add the first template", onClick: () => setDraft(blank()) } : undefined} />
      )}

      {!error && templates !== null && templates.length > 0 && (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-footnote font-semibold">{t.code}</span>
                  <span className="ml-2 text-caption text-fg-subtle">{PURPOSE_LABEL[t.purpose]} · {CHANNEL_LABEL[t.channel]} · v{t.version}{t.project_id ? "" : " · standard"}</span>
                  {LEGAL_BEARING.includes(t.purpose) && (
                    <Badge tone="neutral" className="ml-2 inline-flex items-center gap-1"><PenSquare className="h-3 w-3" /> Legal-bearing</Badge>
                  )}
                </div>
                <Badge className={t.status === "APPROVED" ? "bg-ontrack/10 text-ontrack" : t.status === "RETIRED" ? "bg-surface-2 text-fg-subtle" : "bg-due/10 text-due"}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge>
              </div>
              {t.subject && <p className="mt-1 text-footnote text-fg">{t.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-caption text-fg-muted">{t.body}</p>
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  {t.status === "DRAFT" && <Button size="sm" onClick={() => run(`review-${t.id}`, () => communicationsApi.submitTemplateForLegalReview(t.id))} disabled={busy === `review-${t.id}`}>Submit for review</Button>}
                  {t.status === "LEGAL_REVIEW" && <Button size="sm" onClick={() => run(`approve-${t.id}`, () => communicationsApi.approveTemplate(t.id))} disabled={busy === `approve-${t.id}`}>Approve</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
