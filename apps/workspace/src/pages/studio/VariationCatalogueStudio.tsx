import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { PackageSearch, Trash2 } from "lucide-react";
import { specificationApi, type CatalogueItem } from "../specification/api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL } from "../customisation/labels";

// 09-specification-revisions.md Screens: "Policy Studio → Variation catalogue" (per product/
// category, price, vendor cost, lead days). Own bespoke screen — the real API is a bulk PUT
// upsert (specification/catalogue.ts::putCatalogue), same shape as 18's approval-matrix editor,
// not the generic /studio/:table envelope. Standard (project_id null) scope only, same call
// CustomisationApprovalMatrixStudio already made — a per-project override editor is real,
// separate work nothing in this build needed yet.
type Draft = Omit<CatalogueItem, "id" | "project_id">;

function blank(): Draft {
  return { category_code: CHANGE_CATEGORIES[0], code: "", name: "", description: "", unit_price_inr: 0, vendor_cost_inr: 0, lead_days: 0, product_types: [], constraints: {}, active: true };
}

export function VariationCatalogueStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    specificationApi.listCatalogue({ include_inactive: true }).then((r) => setRows(r.map(({ id: _id, project_id: _pid, ...rest }) => rest))).catch(() => setError(true));
  }
  useEffect(load, []);

  function update(i: number, patch: Partial<Draft>) {
    setRows((r) => r!.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await specificationApi.putCatalogue(rows!.map((r) => ({ ...r, project_id: null })));
      setRows(saved.map(({ id: _id, project_id: _pid, ...rest }) => rest));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save the catalogue.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Variation catalogue"
        description="09-specification-revisions.md — priced items 18's change requests draw from: price, vendor cost, lead days per category. Standard scope; a project can override any code."
        actions={canEdit ? <Button onClick={() => setRows((r) => [...(r ?? []), blank()])}>+ Add item</Button> : undefined}
      />
      {error && <EmptyState icon={PackageSearch} message="Couldn't load the variation catalogue." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && (
        <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>
      )}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState icon={PackageSearch} message="No catalogue items configured yet." action={canEdit ? { label: "Add the first item", onClick: () => setRows([blank()]) } : undefined} />
      )}
      {!error && rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-footnote">
            <thead>
              <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Price (₹)</th>
                <th className="p-2 text-left">Vendor cost (₹)</th>
                <th className="p-2 text-left">Lead days</th>
                <th className="p-2 text-left">Active</th>
                {canEdit && <th className="p-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="p-2">
                    <Select value={r.category_code} onValueChange={(v) => update(i, { category_code: v })} disabled={!canEdit}>
                      <SelectTrigger className="min-w-[9rem]" />
                      <SelectOptions options={CHANGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))} />
                    </Select>
                  </td>
                  <td className="p-2"><Input value={r.code} onChange={(e) => update(i, { code: e.target.value.toUpperCase() })} disabled={!canEdit} className="w-28" /></td>
                  <td className="p-2"><Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} disabled={!canEdit} className="min-w-[10rem]" /></td>
                  <td className="p-2"><Input type="number" value={r.unit_price_inr} onChange={(e) => update(i, { unit_price_inr: Number(e.target.value) })} disabled={!canEdit} className="w-28" /></td>
                  <td className="p-2"><Input type="number" value={r.vendor_cost_inr} onChange={(e) => update(i, { vendor_cost_inr: Number(e.target.value) })} disabled={!canEdit} className="w-28" /></td>
                  <td className="p-2"><Input type="number" value={r.lead_days} onChange={(e) => update(i, { lead_days: Number(e.target.value) })} disabled={!canEdit} className="w-20" /></td>
                  <td className="p-2">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} disabled={!canEdit} />
                      <span className="sr-only">Active</span>
                    </label>
                  </td>
                  {canEdit && (
                    <td className="p-2">
                      <Button variant="ghost" size="sm" onClick={() => setRows((rr) => rr!.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
      {canEdit && rows !== null && rows.length > 0 && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save catalogue"}</Button>}
    </div>
  );
}
