import { useState } from "react";
import { Drawer, DrawerContent, Button } from "@homeflow/ui";
import type { HierarchyNode } from "../../api-model";
import { progressApi, type BulkPreview, type SpecProgressState } from "./api";
import { STATE_META, canSetState } from "./labels";

const STATES: SpecProgressState[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "VERIFIED", "REWORK"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  roles: string[];
  components: { code: string; label: string }[];
  nodes: HierarchyNode[];
  onApplied: () => void;
}

/** Rule 5: two-step bulk update — preview (with gate deltas per unit) before commit
 *  (p44 §33.6 t2 "Bulk update shows affected gates before commit"). */
export function BulkUpdateDrawer({ open, onOpenChange, projectId, roles, components, nodes, onApplied }: Props) {
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [componentCode, setComponentCode] = useState(components[0]?.code ?? "");
  const [newState, setNewState] = useState<SpecProgressState>("IN_PROGRESS");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [excluded, setExcluded] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleNode(id: string) {
    setNodeIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));
  }

  async function runPreview() {
    if (nodeIds.length === 0) { setError("Pick at least one phase/tower/floor."); return; }
    setBusy(true);
    setError(null);
    try {
      const p = await progressApi.previewBulk(projectId, { scope: { node_ids: nodeIds }, component_code: componentCode, new_state: newState, reason: reason.trim() || undefined });
      setPreview(p);
      setExcluded({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't preview.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const exceptions = Object.entries(excluded).filter(([, r]) => r.trim()).map(([unit_id, r]) => ({ unit_id, reason: r.trim() }));
    const excludedIds = new Set(exceptions.map((e) => e.unit_id));
    // Mirrors core.ts's applyBulkUpdate: regression need is recomputed against the units actually
    // being applied (excluded ones don't change state, so they can't regress anything).
    const stillRegresses = preview.units.some((u) => !u.no_op && !excludedIds.has(u.unit_id) && u.regression);
    if (stillRegresses && !reason.trim()) { setError("This bulk update regresses some units — add a reason above, or exclude every regressing unit."); return; }
    setBusy(true);
    setError(null);
    try {
      await progressApi.applyBulk(preview.id, exceptions);
      reset();
      onApplied();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setNodeIds([]);
    setPreview(null);
    setExcluded({});
    setReason("");
  }

  const allowedStates = STATES.filter((s) => canSetState(s, roles));

  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DrawerContent open={open} title="Bulk update progress" width={640}>
        {!preview ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1 text-footnote font-medium text-fg-muted">Scope — phases / towers / floors</div>
              <div className="flex flex-col gap-1 rounded-lg border border-line p-2 max-h-48 overflow-y-auto">
                {nodes.length === 0 && <p className="p-2 text-footnote text-fg-muted">No hierarchy nodes in this project yet.</p>}
                {nodes.map((n) => (
                  <label key={n.id} className="flex items-center gap-2 rounded px-2 py-1 text-footnote hover:bg-surface-2">
                    <input type="checkbox" checked={nodeIds.includes(n.id)} onChange={() => toggleNode(n.id)} />
                    <span className="text-caption uppercase text-fg-subtle">{n.kind}</span>
                    {n.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="text-footnote font-medium text-fg-muted">
              Component
              <select value={componentCode} onChange={(e) => setComponentCode(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-body">
                {components.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-footnote font-medium text-fg-muted">
              New state
              <select value={newState} onChange={(e) => setNewState(e.target.value as SpecProgressState)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-body">
                {allowedStates.map((s) => <option key={s} value={s}>{STATE_META[s].label}</option>)}
              </select>
            </label>
            <label className="text-footnote font-medium text-fg-muted">
              Reason (only needed if this regresses any unit)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
            </label>
            {error && <p className="text-footnote text-overdue">{error}</p>}
            <Button onClick={runPreview} disabled={busy}>{busy ? "Loading…" : "Preview"}</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-footnote text-fg-muted">
              <span><strong className="text-fg">{preview.affected_count}</strong> will change</span>
              <span><strong className="text-fg">{preview.no_op_count}</strong> already there</span>
              {preview.regression_count > 0 && <span className="text-overdue"><strong>{preview.regression_count}</strong> regress</span>}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-footnote">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                    <th className="p-2 text-left">Unit</th>
                    <th className="p-2 text-left">Current</th>
                    <th className="p-2 text-left">Gate deltas</th>
                    <th className="p-2 text-left">Exclude</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.units.filter((u) => !u.no_op).map((u) => (
                    <tr key={u.unit_id} className="border-t border-line">
                      <td className="p-2 font-semibold">{u.unit_number}{u.held && <span className="ml-1 text-caption text-atrisk">(held)</span>}</td>
                      <td className="p-2">{STATE_META[u.current_state].label}{u.regression && <span className="ml-1 text-overdue">regression</span>}</td>
                      <td className="p-2">
                        {u.gate_deltas.length === 0 ? "—" : u.gate_deltas.map((d) => `${d.category_code}: ${d.from}→${d.to}`).join(", ")}
                      </td>
                      <td className="p-2">
                        <input
                          placeholder="reason to exclude"
                          value={excluded[u.unit_id] ?? ""}
                          onChange={(e) => setExcluded((prev) => ({ ...prev, [u.unit_id]: e.target.value }))}
                          className="w-full rounded border border-line bg-surface px-2 py-1 text-caption"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-footnote text-overdue">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={apply} disabled={busy}>{busy ? "Applying…" : `Apply to ${preview.affected_count - Object.values(excluded).filter((r) => r.trim()).length} units`}</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Back</Button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
