import { useState } from "react";
import { Dialog, DialogContent, Field, Select, SelectTrigger, SelectOptions, Button, Skeleton } from "@homeflow/ui";
import { journeyApi } from "./JourneyTemplateStudio";

const PRODUCT_TYPES = [
  { value: "APARTMENT", label: "Apartment" },
  { value: "VILLA", label: "Villa" },
  { value: "PLOT", label: "Plot" },
];
const RESIDENCIES = [
  { value: "RESIDENT", label: "Resident" },
  { value: "NRI", label: "NRI" },
];

/** "Preview for a sample customer (Resident/NRI, product)" — config-time only (05's own doc
 * comment on previewVersion): shows which stages/tasks would instantiate, not a real journey. */
export function JourneyTemplatePreviewDialog({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const [productType, setProductType] = useState<string | undefined>(undefined);
  const [residency, setResidency] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<{ stage_code: string; task_codes: string[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await journeyApi.preview(versionId, productType, residency));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the preview.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Preview for a sample customer" description="Which stages and tasks would instantiate for a hypothetical booking.">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Product type" htmlFor="pv-product">
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger id="pv-product" placeholder="Any" />
                <SelectOptions options={PRODUCT_TYPES} />
              </Select>
            </Field>
            <Field label="Residency" htmlFor="pv-residency">
              <Select value={residency} onValueChange={setResidency}>
                <SelectTrigger id="pv-residency" placeholder="Any" />
                <SelectOptions options={RESIDENCIES} />
              </Select>
            </Field>
          </div>

          <Button size="sm" disabled={busy} onClick={run}>
            Run preview
          </Button>

          {busy && <Skeleton variant="text" />}
          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}

          {result && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {result.map((r) => (
                  <li key={r.stage_code} className="p-2 text-footnote">
                    <span className="font-mono font-medium">{r.stage_code}</span>
                    <span className="text-fg-subtle"> — {r.task_codes.length} task{r.task_codes.length === 1 ? "" : "s"}: {r.task_codes.join(", ") || "none"}</span>
                  </li>
                ))}
              </ul>
              {result.length === 0 && <p className="p-3 text-footnote text-fg-subtle">No stages would instantiate for this combination.</p>}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
