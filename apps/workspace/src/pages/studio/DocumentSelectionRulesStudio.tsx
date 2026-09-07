import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { ListOrdered, Trash2 } from "lucide-react";
import { documentsApi, type TemplateRow, type SelectionRule } from "../documents/api";

type Draft = { clause_code: string; condition: string };

// Rule 5's clause selection — per-template ordered list, condition reuses spec 05's DSL verbatim
// (journey/dsl.ts) — a plain text expression, not a DSL builder, matching journey/dsl.ts's own
// existing Studio surface (Journey Template Studio also takes conditions as raw text).
export function DocumentSelectionRulesStudio({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [rules, setRules] = useState<Draft[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    documentsApi.templates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (!templateId) return setRules(null);
    setError(false);
    documentsApi
      .selectionRules(templateId)
      .then((r: SelectionRule[]) => setRules(r.sort((a, b) => a.position - b.position).map((x) => ({ clause_code: x.clause_code, condition: x.condition ?? "" }))))
      .catch(() => setError(true));
  }, [templateId]);

  async function save() {
    if (!templateId || !rules) return;
    setSaving(true);
    setSaveError(null);
    try {
      await documentsApi.putSelectionRules(templateId, rules.filter((r) => r.clause_code.trim()).map((r) => ({ clause_code: r.clause_code.trim(), condition: r.condition.trim() || null })));
    } catch {
      setSaveError("Couldn't save the selection rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Clause selection rules" description="Per template, the ordered list of clauses to apply — an optional condition skips a clause when it doesn't match (e.g. customer.residency == 'NRI')." />
      <Field label="Template" htmlFor="dsr-template">
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger id="dsr-template" placeholder="Select a template" />
          <SelectOptions options={templates.map((t) => ({ value: t.id, label: `${t.name} (v${t.version}, ${t.status})` }))} />
        </Select>
      </Field>

      {!templateId && <p className="text-footnote text-fg-muted">Select a template to edit its clause rules.</p>}
      {templateId && error && <EmptyState icon={ListOrdered} message="Couldn't load selection rules." />}
      {templateId && !error && rules === null && <Skeleton />}
      {templateId && !error && rules !== null && (
        <div className="flex flex-col gap-2">
          {rules.length === 0 && <p className="text-footnote text-fg-muted">No clause rules yet for this template.</p>}
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-2">
              <Field label="Clause code" htmlFor={`dsr-code-${i}`}>
                <Input id={`dsr-code-${i}`} value={r.clause_code} onChange={(e) => setRules((rs) => rs!.map((x, idx) => (idx === i ? { ...x, clause_code: e.target.value.toUpperCase() } : x)))} disabled={!canEdit} />
              </Field>
              <Field label="Condition (optional)" htmlFor={`dsr-cond-${i}`}>
                <Input id={`dsr-cond-${i}`} value={r.condition} onChange={(e) => setRules((rs) => rs!.map((x, idx) => (idx === i ? { ...x, condition: e.target.value } : x)))} disabled={!canEdit} placeholder="e.g. customer.residency == 'NRI'" />
              </Field>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setRules((rs) => rs!.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRules((rs) => [...(rs ?? []), { clause_code: "", condition: "" }])}>+ Add row</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save rules"}</Button>
            </div>
          )}
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
        </div>
      )}
    </div>
  );
}
