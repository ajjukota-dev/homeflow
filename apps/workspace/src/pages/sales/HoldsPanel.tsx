import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Button, Badge, Dialog, DialogContent, Field, Select, SelectTrigger, SelectOptions, Input, EmptyState, Skeleton } from "@homeflow/ui";
import { Clock, Lock } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesApi, type Hold, type InventoryUnit, type HoldPolicy } from "./api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL, HOLD_STATUS_LABEL } from "./labels";

const REQUEST_ROLES = ["SALES", "MANAGEMENT", "SUPER_ADMIN"]; // sales/holds.ts's real REQUEST_ROLES

function RequestHoldDialog({ units, onCreated }: { units: InventoryUnit[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUnitId(""); setCategory(""); setReason(""); setUntil(""); setError(null);
  }

  async function submit() {
    if (!unitId || !category || !reason.trim() || !until) return setError("Unit, category, reason, and an until date are all required.");
    setBusy(true);
    setError(null);
    try {
      await salesApi.requestHold({ unit_id: unitId, category_code: category, reason: reason.trim(), requested_until: until });
      setOpen(false);
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't request that hold.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button onClick={() => setOpen(true)}>+ Request hold</Button>
      <DialogContent title="Request a Change Window Hold" description="Rule 6 — time-bound, needs approval, freezes one category's gate from closing further while active.">
        <div className="flex flex-col gap-3">
          <Field label="Unit" htmlFor="hold-unit" required>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger id="hold-unit" placeholder="Select a unit" />
              <SelectOptions options={units.map((u) => ({ value: u.unit_id, label: `Villa ${u.unit_number}` }))} />
            </Select>
          </Field>
          <Field label="Category" htmlFor="hold-category" required>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="hold-category" placeholder="Select a category" />
              <SelectOptions options={CHANGE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            </Select>
          </Field>
          <Field label="Hold until" htmlFor="hold-until" required>
            <Input id="hold-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="hold-reason" required>
            <Input id="hold-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Buyer deciding on kitchen layout" />
          </Field>
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button onClick={submit} disabled={busy}>{busy ? "Requesting…" : "Request hold"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 24-sales-inventory-discovery.md rule 6 Screen "Holds" — request queue + approve/reject/release,
 *  gated on hold_policy.approver_role (loaded live, never assumed). */
export function HoldsPanel({ projectId, units, roles }: { projectId: string; units: InventoryUnit[]; roles: string[] }) {
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [policy, setPolicy] = useState<HoldPolicy | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    salesApi.listHolds(projectId).then(setHolds).catch(() => setError(true));
    salesApi.getHoldPolicy(projectId).then(setPolicy).catch(() => setPolicy(null));
  }, [projectId]);
  useEffect(load, [load]);

  const canRequest = roles.some((r) => REQUEST_ROLES.includes(r));
  const canDecide = !!policy && (roles.includes(policy.approver_role) || roles.includes("SUPER_ADMIN"));

  async function act(fn: () => Promise<unknown>) {
    setBusyId("_");
    try {
      await fn();
      load();
    } catch {
      // surfaced via a failed refresh — the list itself stays authoritative
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title2 font-bold text-fg">Change Window Holds</h2>
          <p className="text-footnote text-fg-muted">
            {policy ? `Approver role: ${policy.approver_role} · max ${policy.max_days} days · ${policy.max_active_per_project} active per project` : "Loading policy…"}
          </p>
        </div>
        {canRequest && <RequestHoldDialog units={units} onCreated={load} />}
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && holds === null && (
        <div className="flex flex-col gap-2">
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      )}
      {!error && holds !== null && holds.length === 0 && (
        <EmptyState icon={Lock} message="No holds requested for this project yet." />
      )}
      {!error && holds !== null && holds.length > 0 && (
        <div className="flex flex-col gap-2">
          {holds.map((h) => {
            const u = units.find((x) => x.unit_id === h.unit_id);
            return (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-subhead font-semibold text-fg">{h.code}</span>
                    <Badge>{HOLD_STATUS_LABEL[h.status] ?? h.status}</Badge>
                  </div>
                  <p className="text-footnote text-fg-muted">
                    Villa {u?.unit_number ?? h.unit_id.slice(0, 8)} · {CATEGORY_LABEL[h.category_code] ?? h.category_code} · {h.reason}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-caption text-fg-subtle">
                    <Clock className="h-3 w-3" /> Until {new Date(h.approved_until ?? h.requested_until).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {h.status === "REQUESTED" && canDecide && (
                    <>
                      <Button size="sm" onClick={() => act(() => salesApi.approveHold(h.id))} disabled={busyId === "_"}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => act(() => salesApi.rejectHold(h.id))} disabled={busyId === "_"}>Reject</Button>
                    </>
                  )}
                  {(h.status === "REQUESTED" || h.status === "APPROVED") && canRequest && (
                    <Button size="sm" variant="secondary" onClick={() => act(() => salesApi.releaseHold(h.id, "Released from Holds panel"))} disabled={busyId === "_"}>Release</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
