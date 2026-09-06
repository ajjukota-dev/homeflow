import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Gavel, Trash2 } from "lucide-react";
import { changeRequestsApi, type CrApprovalRule } from "../customisation/api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL } from "../customisation/labels";

// 18-change-requests.md Screens: "Studio tabs: Variation approval matrix". Own bespoke table
// (cr_approval_rule), not the generic /studio/:table envelope — same "own bespoke versioning"
// call this spec's own backend Build note already made. Standard (project_id null) scope only —
// a per-project override editor is real, separate work nothing in this build needed yet.
const KINDS: CrApprovalRule["kind"][] = ["VALUE", "MARGIN", "SCHEDULE", "FREEZE", "CATEGORY"];
type Draft = Omit<CrApprovalRule, "id" | "project_id">;

function blank(): Draft {
  return { kind: "VALUE", category_code: null, threshold: null, approver_role: "MANAGEMENT", requires_second_approver: false, second_approver_role: null, effective_from: new Date().toISOString().slice(0, 10), effective_to: null };
}

export function CustomisationApprovalMatrixStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    changeRequestsApi.approvalRules(null).then((r) => setRows(r.map(({ id: _id, project_id: _pid, ...rest }) => rest))).catch(() => setError(true));
  }
  useEffect(load, []);

  function update(i: number, patch: Partial<Draft>) {
    setRows((r) => r!.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await changeRequestsApi.putApprovalRules(null, rows!);
      setRows(saved.map(({ id: _id, project_id: _pid, ...rest }) => rest));
    } catch {
      setSaveError("Couldn't save the matrix.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Variation approval matrix"
        description="18-change-requests.md rule 4 — required approver roles by value, margin, schedule impact, freeze state and category, standard scope."
        actions={canEdit ? <Button onClick={() => setRows((r) => [...(r ?? []), blank()])}>+ Add rule</Button> : undefined}
      />
      {error && <EmptyState icon={Gavel} message="Couldn't load the approval matrix." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState icon={Gavel} message="No approval rules configured yet." action={canEdit ? { label: "Add the first rule", onClick: () => setRows([blank()]) } : undefined} />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Kind" htmlFor={`car-kind-${i}`}>
                  <Select value={r.kind} onValueChange={(v) => update(i, { kind: v as CrApprovalRule["kind"] })} disabled={!canEdit}>
                    <SelectTrigger id={`car-kind-${i}`} />
                    <SelectOptions options={KINDS.map((k) => ({ value: k, label: k }))} />
                  </Select>
                </Field>
                {r.kind === "CATEGORY" && (
                  <Field label="Category" htmlFor={`car-cat-${i}`}>
                    <Select value={r.category_code ?? ""} onValueChange={(v) => update(i, { category_code: v })} disabled={!canEdit}>
                      <SelectTrigger id={`car-cat-${i}`} />
                      <SelectOptions options={CHANGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
                    </Select>
                  </Field>
                )}
                {r.kind !== "CATEGORY" && r.kind !== "FREEZE" && (
                  <Field label={r.kind === "VALUE" ? "Threshold (₹)" : r.kind === "MARGIN" ? "Threshold (%)" : "Threshold (days)"} htmlFor={`car-threshold-${i}`}>
                    <Input id={`car-threshold-${i}`} type="number" value={r.threshold ?? ""} onChange={(e) => update(i, { threshold: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canEdit} />
                  </Field>
                )}
                <Field label="Approver role" htmlFor={`car-role-${i}`}>
                  <Input id={`car-role-${i}`} value={r.approver_role} onChange={(e) => update(i, { approver_role: e.target.value.toUpperCase() })} disabled={!canEdit} />
                </Field>
                {r.kind === "FREEZE" && (
                  <>
                    <label className="flex items-center gap-2 text-footnote text-fg">
                      <input type="checkbox" checked={r.requires_second_approver} onChange={(e) => update(i, { requires_second_approver: e.target.checked })} disabled={!canEdit} />
                      Requires second approver
                    </label>
                    {r.requires_second_approver && (
                      <Field label="Second approver role" htmlFor={`car-second-${i}`}>
                        <Input id={`car-second-${i}`} value={r.second_approver_role ?? ""} onChange={(e) => update(i, { second_approver_role: e.target.value.toUpperCase() })} disabled={!canEdit} />
                      </Field>
                    )}
                  </>
                )}
              </div>
              {canEdit && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRows((rr) => rr!.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          ))}
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save matrix"}</Button>}
        </div>
      )}
    </div>
  );
}
