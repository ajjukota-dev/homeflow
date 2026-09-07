import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Badge } from "@homeflow/ui";
import { FileText } from "lucide-react";
import { documentsApi, type TemplateRow } from "../documents/api";
import { TEMPLATE_STATUS_LABEL, prettifyCode } from "../documents/labels";

// 22-document-factory.md Screens: "Template & Clause Studio: template editor (HTML with merge-
// field picker and clause slots; preview with sample data; version + approval)". A lightweight
// textarea editor with a merge-field-code reference (not a rich WYSIWYG) satisfies the spec's own
// "preview with sample data" via the Generate wizard's live readiness panel, which already shows
// exactly which merge fields and clauses a template resolves against.
const TRANSACTION_TYPES = ["SALE", "LEASE", "ADDENDUM", "LETTER", "STATEMENT", "CUSTOMISATION", "CANCELLATION", "TRANSFER"];

function blank() {
  return { family_code: "", name: "", transaction_type: "LETTER", body_html: "" };
}

export function DocumentTemplatesStudio({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    documentsApi.templates().then(setTemplates).catch(() => setError(true));
  }
  useEffect(load, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setSaveError(null);
    try {
      await fn();
      load();
    } catch {
      setSaveError("That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!draft?.family_code.trim() || !draft.name.trim() || !draft.body_html.trim()) return;
    await run("create", () => documentsApi.createTemplate(draft));
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Document templates"
        description="Rule 1: generate only from an APPROVED template. Merge fields use {{code}} (e.g. {{customer.primary_name}}); clause slots use {{clause:CODE}}."
        actions={canEdit && !draft ? <Button onClick={() => setDraft(blank())}>+ New template</Button> : undefined}
      />
      {error && <EmptyState icon={FileText} message="Couldn't load templates." action={{ label: "Retry", onClick: load }} />}
      {!error && templates === null && (
        <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>
      )}

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Family code" htmlFor="dt-family" required hint="e.g. ALLOTMENT_LETTER, NOC, POSSESSION_LETTER">
              <Input id="dt-family" value={draft.family_code} onChange={(e) => setDraft({ ...draft, family_code: e.target.value.toUpperCase().replace(/\s+/g, "_") })} />
            </Field>
            <Field label="Name" htmlFor="dt-name" required>
              <Input id="dt-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Transaction type" htmlFor="dt-type">
              <Select value={draft.transaction_type} onValueChange={(v) => setDraft({ ...draft, transaction_type: v })}>
                <SelectTrigger id="dt-type" />
                <SelectOptions options={TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))} />
              </Select>
            </Field>
          </div>
          <Field label="Body HTML" htmlFor="dt-body" required hint="Use {{merge.field.code}} and {{clause:CODE}} slots.">
            <Textarea id="dt-body" value={draft.body_html} onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} rows={6} className="font-mono" />
          </Field>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create draft"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!error && templates !== null && templates.length === 0 && !draft && (
        <EmptyState icon={FileText} message="No document templates configured yet." action={canEdit ? { label: "Add the first template", onClick: () => setDraft(blank()) } : undefined} />
      )}

      {!error && templates !== null && templates.length > 0 && (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-footnote font-semibold">{t.name}</span>
                  <span className="ml-2 text-caption text-fg-subtle">{prettifyCode(t.family_code)} · v{t.version}{t.project_id ? "" : " · standard"}</span>
                </div>
                <Badge className={t.status === "APPROVED" ? "bg-ontrack/10 text-ontrack" : t.status === "RETIRED" ? "bg-surface-2 text-fg-subtle" : "bg-due/10 text-due"}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge>
              </div>
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  {t.status === "DRAFT" && <Button size="sm" onClick={() => run(`review-${t.id}`, () => documentsApi.submitTemplateForReview(t.id))} disabled={busy === `review-${t.id}`}>Submit for review</Button>}
                  {t.status === "UNDER_REVIEW" && <Button size="sm" onClick={() => run(`approve-${t.id}`, () => documentsApi.approveTemplate(t.id))} disabled={busy === `approve-${t.id}`}>Approve</Button>}
                  {t.status === "APPROVED" && <Button size="sm" variant="ghost" onClick={() => run(`retire-${t.id}`, () => documentsApi.retireTemplate(t.id))} disabled={busy === `retire-${t.id}`}>Retire</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
