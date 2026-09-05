import { useState } from "react";
import { api } from "../../api";
import type { BulkUnitRangeInput, ProductType } from "../../api-model";
import { Card, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";

// Bulk range create (04 §Screens "Units"): e.g. floors 1-12 × units A-D.

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";
const PRODUCT_TYPES: ProductType[] = ["APARTMENT", "VILLA", "PLOT", "MIXED"];

export function BulkUnitForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [form, setForm] = useState<BulkUnitRangeInput>({
    floor_from: 1,
    floor_to: 1,
    letter_from: "A",
    letter_to: "A",
    unit_type: "3BHK",
    facing: "East",
    product_type: "APARTMENT",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { count } = await api.bulkCreateUnits(projectId, form);
      setLastCount(count);
      onCreated();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-title3 font-semibold">Bulk create from a range</h2>
        {error && <p className="mb-2 text-footnote text-overdue">{error}</p>}
        {lastCount != null && !error && (
          <p className="mb-2 text-footnote text-ontrack">Created {lastCount} units.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-footnote text-fg-muted">
            Floor from
            <input
              type="number"
              className={inputCls}
              value={form.floor_from}
              onChange={(e) => setForm({ ...form, floor_from: Number(e.target.value) })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Floor to
            <input
              type="number"
              className={inputCls}
              value={form.floor_to}
              onChange={(e) => setForm({ ...form, floor_to: Number(e.target.value) })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Unit letter from
            <input
              maxLength={1}
              className={inputCls}
              value={form.letter_from}
              onChange={(e) => setForm({ ...form, letter_from: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Unit letter to
            <input
              maxLength={1}
              className={inputCls}
              value={form.letter_to}
              onChange={(e) => setForm({ ...form, letter_to: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Unit type
            <input
              className={inputCls}
              value={form.unit_type}
              onChange={(e) => setForm({ ...form, unit_type: e.target.value })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Facing
            <input
              className={inputCls}
              value={form.facing}
              onChange={(e) => setForm({ ...form, facing: e.target.value })}
            />
          </label>
          <label className="text-footnote text-fg-muted">
            Product type
            <select
              className={inputCls}
              value={form.product_type}
              onChange={(e) => setForm({ ...form, product_type: e.target.value as ProductType })}
            >
              {PRODUCT_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-footnote text-fg-muted">
            Base price (INR)
            <input
              type="number"
              className={inputCls}
              value={form.base_price_inr ?? ""}
              onChange={(e) => setForm({ ...form, base_price_inr: Number(e.target.value) || undefined })}
            />
          </label>
        </div>
        <Button size="sm" className="mt-4" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create units"}
        </Button>
      </CardBody>
    </Card>
  );
}
