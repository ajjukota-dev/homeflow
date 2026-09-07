import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { ClipboardCheck, Trash2 } from "lucide-react";
import { documentsApi, type ChecklistRuleRow } from "../documents/api";

const RESIDENCIES = ["RESIDENT", "NRI", "OCI", "ANY"];
const CATEGORIES = [
  "PAN", "IDENTITY_PROOF", "ADDRESS_PROOF", "PHOTOGRAPH", "PASSPORT", "OCI", "BOOKING_FORM",
  "COST_SHEET", "AGREEMENT", "TDS_CHALLAN", "LOAN_DOCUMENTS", "REGISTRATION_DOCUMENTS", "POA", "HANDOVER_DOCUMENTS", "OTHER",
];
type Draft = Omit<ChecklistRuleRow, "id">;

function blank(): Draft {
  return { residency: "RESIDENT", product_type: null, project_id: null, category: "PAN", required: true, stage_code: null };
}

export function DocumentChecklistRulesStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    documentsApi.checklistRules().then((r) => setRows(r.map(({ id: _id, ...rest }) => rest))).catch(() => setError(true));
  }
  useEffect(load, []);

  function update(i: number, patch: Partial<Draft>) {
    setRows((r) => r!.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await documentsApi.putChecklistRules(rows);
      setRows(saved.map(({ id: _id, ...rest }) => rest));
    } catch {
      setSaveError("Couldn't save checklist rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Document checklist rules"
        description="Rule 8: which customer documents are required, by residency and product type — seeds each booking's checklist on CRM acceptance."
        actions={canEdit ? <Button onClick={() => setRows((r) => [...(r ?? []), blank()])}>+ Add rule</Button> : undefined}
      />
      {error && <EmptyState icon={ClipboardCheck} message="Couldn't load checklist rules." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState icon={ClipboardCheck} message="No checklist rules configured yet." action={canEdit ? { label: "Add the first rule", onClick: () => setRows([blank()]) } : undefined} />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:grid-cols-4 sm:items-end">
              <Field label="Residency" htmlFor={`dcr-res-${i}`}>
                <Select value={r.residency} onValueChange={(v) => update(i, { residency: v })} disabled={!canEdit}>
                  <SelectTrigger id={`dcr-res-${i}`} />
                  <SelectOptions options={RESIDENCIES.map((x) => ({ value: x, label: x }))} />
                </Select>
              </Field>
              <Field label="Category" htmlFor={`dcr-cat-${i}`}>
                <Select value={r.category} onValueChange={(v) => update(i, { category: v })} disabled={!canEdit}>
                  <SelectTrigger id={`dcr-cat-${i}`} />
                  <SelectOptions options={CATEGORIES.map((x) => ({ value: x, label: x }))} />
                </Select>
              </Field>
              <Field label="Product type (optional)" htmlFor={`dcr-pt-${i}`}>
                <Input id={`dcr-pt-${i}`} value={r.product_type ?? ""} onChange={(e) => update(i, { product_type: e.target.value || null })} disabled={!canEdit} />
              </Field>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-footnote text-fg">
                  <input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} disabled={!canEdit} />
                  Required
                </label>
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs!.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save rules"}</Button>}
        </div>
      )}
    </div>
  );
}
