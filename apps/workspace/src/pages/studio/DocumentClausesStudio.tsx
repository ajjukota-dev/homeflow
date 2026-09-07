import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Badge } from "@homeflow/ui";
import { ScrollText } from "lucide-react";
import { documentsApi, type ClauseRow } from "../documents/api";
import { CLAUSE_TYPE_LABEL, clauseTypeTone } from "../documents/labels";

const CLAUSE_TYPES = ["LOCKED", "PARAMETERIZED", "NEGOTIABLE_WITH_APPROVAL"];

function blank(): { code: string; title: string; type: ClauseRow["type"]; body_html: string } {
  return { code: "", title: "", type: "LOCKED", body_html: "" };
}

export function DocumentClausesStudio({ canEdit }: { canEdit: boolean }) {
  const [clauses, setClauses] = useState<ClauseRow[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    documentsApi.clauses().then(setClauses).catch(() => setError(true));
  }
  useEffect(load, []);

  async function approve(id: string) {
    setBusy(id);
    setSaveError(null);
    try {
      await documentsApi.approveClause(id);
      load();
    } catch {
      setSaveError("Couldn't approve.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!draft?.code.trim() || !draft.title.trim() || !draft.body_html.trim()) return;
    setBusy("create");
    setSaveError(null);
    try {
      await documentsApi.createClause(draft);
      setDraft(null);
      load();
    } catch {
      setSaveError("Couldn't create clause.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clause library"
        description="Rule 5: LOCKED cannot be edited in a document, PARAMETERIZED accepts parameters, NEGOTIABLE_WITH_APPROVAL needs a Legal deviation approval (never the raiser)."
        actions={canEdit && !draft ? <Button onClick={() => setDraft(blank())}>+ New clause</Button> : undefined}
      />
      {error && <EmptyState icon={ScrollText} message="Couldn't load clauses." action={{ label: "Retry", onClick: load }} />}
      {!error && clauses === null && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>}

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Code" htmlFor="cl-code" required>
              <Input id="cl-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })} />
            </Field>
            <Field label="Title" htmlFor="cl-title" required>
              <Input id="cl-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Type" htmlFor="cl-type">
              <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as ClauseRow["type"] })}>
                <SelectTrigger id="cl-type" />
                <SelectOptions options={CLAUSE_TYPES.map((t) => ({ value: t, label: CLAUSE_TYPE_LABEL[t] }))} />
              </Select>
            </Field>
          </div>
          <Field label="Body HTML" htmlFor="cl-body" required>
            <Textarea id="cl-body" value={draft.body_html} onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} rows={4} className="font-mono" />
          </Field>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create draft"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!error && clauses !== null && clauses.length === 0 && !draft && (
        <EmptyState icon={ScrollText} message="No clauses configured yet." action={canEdit ? { label: "Add the first clause", onClick: () => setDraft(blank()) } : undefined} />
      )}

      {!error && clauses !== null && clauses.length > 0 && (
        <div className="flex flex-col gap-2">
          {clauses.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-footnote font-semibold">{c.title}</span>
                  <span className="ml-2 text-caption text-fg-subtle">{c.code} · v{c.version}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={clauseTypeTone(c.type)}>{CLAUSE_TYPE_LABEL[c.type]}</Badge>
                  <Badge className={c.status === "APPROVED" ? "bg-ontrack/10 text-ontrack" : c.status === "RETIRED" ? "bg-surface-2 text-fg-subtle" : "bg-due/10 text-due"}>{c.status}</Badge>
                </div>
              </div>
              {canEdit && c.status === "DRAFT" && (
                <Button size="sm" className="mt-2" onClick={() => approve(c.id)} disabled={busy === c.id}>Approve</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
