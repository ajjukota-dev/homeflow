import { useEffect, useState } from "react";
import { Button, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Trash2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { changeRequestsApi, type CrItem, type CatalogueItem } from "./api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL } from "./labels";

type Draft = { category_code: string; catalogue_item_id: string; description: string; qty: number; unit_price_inr: number; vendor_cost_inr: number; tax_pct: number; lead_days: number; room: string; trade: string };

function blankDraft(categoryCode: string): Draft {
  return { category_code: categoryCode, catalogue_item_id: "", description: "", qty: 1, unit_price_inr: 0, vendor_cost_inr: 0, tax_pct: 0, lead_days: 0, room: "", trade: "" };
}

/** 18-change-requests.md rule 3: line items editor — catalogue picker (price/lead prefilled,
 *  read-only once picked) or a bespoke row with its own price/vendor cost/tax/lead days. */
export function ItemsEditor({ crId, projectId, primaryCategory, existing, onSaved }: { crId: string; projectId: string; primaryCategory: string | null; existing: CrItem[]; onSaved: (items: CrItem[]) => void }) {
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [rows, setRows] = useState<Draft[]>(
    existing.length > 0
      ? existing.map((it) => ({ category_code: it.category_code, catalogue_item_id: it.catalogue_item_id ?? "", description: it.description, qty: it.qty, unit_price_inr: it.unit_price_inr, vendor_cost_inr: it.vendor_cost_inr, tax_pct: it.tax_pct, lead_days: it.lead_days, room: it.room ?? "", trade: it.trade ?? "" }))
      : [blankDraft(primaryCategory ?? CHANGE_CATEGORIES[0])]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    changeRequestsApi.catalogue(projectId).then(setCatalogue).catch(() => setCatalogue([]));
  }, [projectId]);

  function updateRow(i: number, patch: Partial<Draft>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function pickCatalogueItem(i: number, catalogueItemId: string) {
    const c = catalogue.find((x) => x.id === catalogueItemId);
    if (!c) return updateRow(i, { catalogue_item_id: "" });
    updateRow(i, { catalogue_item_id: catalogueItemId, description: c.name, unit_price_inr: c.unit_price_inr, vendor_cost_inr: c.vendor_cost_inr, lead_days: c.lead_days, category_code: c.category_code });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const items = rows.map((r) => ({
        category_code: r.category_code, catalogue_item_id: r.catalogue_item_id || undefined, description: r.description,
        qty: r.qty, unit_price_inr: r.unit_price_inr, vendor_cost_inr: r.vendor_cost_inr, tax_pct: r.tax_pct, lead_days: r.lead_days,
        room: r.room || undefined, trade: r.trade || undefined,
      }));
      const saved = await changeRequestsApi.putItems(crId, items);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Category" htmlFor={`cri-cat-${i}`}>
                <Select value={row.category_code} onValueChange={(v) => updateRow(i, { category_code: v })}>
                  <SelectTrigger id={`cri-cat-${i}`} />
                  <SelectOptions options={CHANGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
                </Select>
              </Field>
              <Field label="Catalogue item (optional)" htmlFor={`cri-catalogue-${i}`} hint="Leave unset for a bespoke item priced below.">
                <Select value={row.catalogue_item_id} onValueChange={(v) => pickCatalogueItem(i, v)}>
                  <SelectTrigger id={`cri-catalogue-${i}`} placeholder="Bespoke item" />
                  <SelectOptions options={catalogue.filter((c) => c.category_code === row.category_code).map((c) => ({ value: c.id, label: `${c.name} — ₹${c.unit_price_inr.toLocaleString("en-IN")}` }))} />
                </Select>
              </Field>
              <Field label="Description" htmlFor={`cri-desc-${i}`} className="sm:col-span-2">
                <Input id={`cri-desc-${i}`} value={row.description} onChange={(e) => updateRow(i, { description: e.target.value })} disabled={!!row.catalogue_item_id} />
              </Field>
              <Field label="Qty" htmlFor={`cri-qty-${i}`}>
                <Input id={`cri-qty-${i}`} type="number" min={1} value={row.qty} onChange={(e) => updateRow(i, { qty: Number(e.target.value) || 1 })} />
              </Field>
              <Field label="Unit price (₹)" htmlFor={`cri-price-${i}`}>
                <Input id={`cri-price-${i}`} type="number" min={0} value={row.unit_price_inr} onChange={(e) => updateRow(i, { unit_price_inr: Number(e.target.value) || 0 })} disabled={!!row.catalogue_item_id} />
              </Field>
              <Field label="Vendor cost (₹)" htmlFor={`cri-vcost-${i}`}>
                <Input id={`cri-vcost-${i}`} type="number" min={0} value={row.vendor_cost_inr} onChange={(e) => updateRow(i, { vendor_cost_inr: Number(e.target.value) || 0 })} disabled={!!row.catalogue_item_id} />
              </Field>
              <Field label="Tax %" htmlFor={`cri-tax-${i}`}>
                <Input id={`cri-tax-${i}`} type="number" min={0} value={row.tax_pct} onChange={(e) => updateRow(i, { tax_pct: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            {rows.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} aria-label="Remove item">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, blankDraft(primaryCategory ?? CHANGE_CATEGORIES[0])])}>
        + Add item
      </Button>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save items"}</Button>
    </div>
  );
}
