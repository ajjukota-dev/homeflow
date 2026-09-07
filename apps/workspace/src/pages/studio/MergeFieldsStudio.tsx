import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Braces, Trash2 } from "lucide-react";
import { documentsApi, type MergeFieldRow } from "../documents/api";

const TYPES = ["STRING", "NUMBER", "DATE", "MONEY", "BOOLEAN"];

export function MergeFieldsStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<MergeFieldRow[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    documentsApi.mergeFields().then(setRows).catch(() => setError(true));
  }
  useEffect(load, []);

  function update(i: number, patch: Partial<MergeFieldRow>) {
    setRows((r) => r!.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await documentsApi.putMergeFields(rows.filter((r) => r.code.trim() && r.source_path.trim()));
      setRows(saved);
    } catch {
      setSaveError("Couldn't save merge fields.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Merge fields"
        description="Rule 2's readiness panel resolves against these — code is what a template's {{code}} slot references, source_path is where the value comes from."
        actions={canEdit ? <Button onClick={() => setRows((r) => [...(r ?? []), { code: "", source_path: "", type: "STRING", format: null, required: false, sensitivity: null }])}>+ Add field</Button> : undefined}
      />
      {error && <EmptyState icon={Braces} message="Couldn't load merge fields." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState icon={Braces} message="No merge fields configured yet." action={canEdit ? { label: "Add the first field", onClick: () => setRows([{ code: "", source_path: "", type: "STRING", format: null, required: false, sensitivity: null }]) } : undefined} />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:grid-cols-5 sm:items-end">
              <Field label="Code" htmlFor={`mf-code-${i}`}>
                <Input id={`mf-code-${i}`} value={r.code} onChange={(e) => update(i, { code: e.target.value })} disabled={!canEdit} placeholder="customer.primary_name" />
              </Field>
              <Field label="Source path" htmlFor={`mf-src-${i}`}>
                <Input id={`mf-src-${i}`} value={r.source_path} onChange={(e) => update(i, { source_path: e.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Type" htmlFor={`mf-type-${i}`}>
                <Select value={r.type} onValueChange={(v) => update(i, { type: v as MergeFieldRow["type"] })} disabled={!canEdit}>
                  <SelectTrigger id={`mf-type-${i}`} />
                  <SelectOptions options={TYPES.map((t) => ({ value: t, label: t }))} />
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-footnote text-fg">
                <input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} disabled={!canEdit} />
                Required
              </label>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs!.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          ))}
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save merge fields"}</Button>}
        </div>
      )}
    </div>
  );
}
