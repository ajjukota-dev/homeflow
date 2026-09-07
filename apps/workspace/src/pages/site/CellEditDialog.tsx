import { useState } from "react";
import { Dialog, DialogContent, Button } from "@homeflow/ui";
import { formatIstDateTime } from "../../lib/utils";
import { progressApi, type ProgressCell, type SpecProgressState } from "./api";
import { STATE_META, canSetState } from "./labels";

const STATES: SpecProgressState[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "VERIFIED", "REWORK"];

// Rule 3: a regression (COMPLETE/VERIFIED -> anything lower) needs a reason, enforced server-side —
// this dialog surfaces the field proactively rather than round-tripping on a 400.
function isRegression(from: SpecProgressState, to: SpecProgressState): boolean {
  const rank: Record<SpecProgressState, number> = { NOT_STARTED: 0, IN_PROGRESS: 1, REWORK: 1, COMPLETE: 2, VERIFIED: 3 };
  return (from === "COMPLETE" || from === "VERIFIED") && rank[to] < rank[from];
}

/** Rule 8: only the structure family (and its parent_code children) accepts an explicit pct. */
export function CellEditDialog({
  open, unitId, unitNumber, cell, roles, isStructureFamily, onClose, onSaved,
}: {
  open: boolean;
  unitId: string;
  unitNumber: string;
  cell: ProgressCell;
  roles: string[];
  isStructureFamily: boolean;
  onClose: () => void;
  onSaved: (components: ProgressCell[]) => void;
}) {
  const [state, setState] = useState<SpecProgressState>(cell.state_code);
  const [pct, setPct] = useState<string>(cell.pct !== null ? String(cell.pct) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regressing = isRegression(cell.state_code, state);
  const allowed = STATES.filter((s) => canSetState(s, roles));

  async function save() {
    if (regressing && !reason.trim()) { setError("Regressing from " + STATE_META[cell.state_code].label + " needs a reason."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await progressApi.updateCell(unitId, cell.component_code, {
        state_code: state,
        pct: isStructureFamily && pct.trim() ? Number(pct) : undefined,
        reason: regressing ? reason.trim() : undefined,
      });
      onSaved(res.components);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${cell.label} — ${unitNumber}`} description={`Last: ${STATE_META[cell.state_code].label} · ${formatIstDateTime(cell.updated_at)}${cell.updated_by_name ? ` · ${cell.updated_by_name}` : ""}`}>
        <div className="flex flex-col gap-3">
          <label className="text-footnote font-medium text-fg-muted">
            State
            <select value={state} onChange={(e) => setState(e.target.value as SpecProgressState)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-body">
              {allowed.map((s) => (
                <option key={s} value={s}>{STATE_META[s].label}</option>
              ))}
            </select>
          </label>
          {isStructureFamily && (
            <label className="text-footnote font-medium text-fg-muted">
              % complete (slab count)
              <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-body" />
            </label>
          )}
          {regressing && (
            <label className="text-footnote font-medium text-fg-muted">
              Reason (required — this regresses a declared/verified state)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
            </label>
          )}
          {error && <p className="text-footnote text-overdue">{error}</p>}
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
