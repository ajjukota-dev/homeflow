import { useEffect, useState } from "react";
import { Button, Textarea } from "@homeflow/ui";
import { actionApi, type ActionDetail } from "./api";

// 10-universal-action.md rule 3's transition set, purely structural (status + family only) — no
// client-side role/ownership simulation. The server is the single source of truth for who may act
// (assertMayAct/approver_role/verifier_role in actions/core.ts); an actor without permission simply
// sees the server's 403 surfaced as an inline error, same "let the server say no" precedent as
// Policy Studio's FM/dlp_policy mismatch (25's own Build note).
//
// Known gap, flagged not fixed: there is no endpoint back from Waiting Internal/Customer to In
// Progress (only Unblock returns Blocked -> In Progress) — rule 3's prose reads
// "IN_PROGRESS<->WAITING_*" as bidirectional but core.ts's waitAction only ever moves further into
// a Waiting state. This drawer does not fabricate a workaround; Close/Cancel remain reachable.
//
// Close/Approve/Cancel are hidden (not merely disabled) for a task-backed action (a.task_instance_id
// set) — the server refuses them from an external caller too (actions/core.ts's isTaskBacked
// guard), since closing/approving/cancelling one directly here would desync `task_instance`/the
// journey (no reverse-direction event subscriber exists yet, rule 7's still-unbuilt half). Reject
// stays available — it only moves Ready for Approval back to In Progress, nothing completes.

type Key = "claim" | "start" | "waitInternal" | "waitCustomer" | "block" | "unblock" | "submitApproval" | "approve" | "reject" | "close" | "cancel";

// A transition either fires immediately (no reason, no note worth surfacing — claim/start/unblock/
// submitApproval) or opens a small confirm panel first: always when a reason is required, and also
// for close/approve so their optional note has somewhere to go.
interface Def { key: Key; label: string; variant: "primary" | "secondary" | "danger"; reasonRequired: boolean; reasonLabel: string; needsPanel: boolean }

const immediate = (key: Key, label: string, variant: Def["variant"]): Def => ({ key, label, variant, reasonRequired: false, reasonLabel: "", needsPanel: false });
const withNote = (key: Key, label: string, variant: Def["variant"], reasonLabel: string): Def => ({ key, label, variant, reasonRequired: false, reasonLabel, needsPanel: true });
const withReason = (key: Key, label: string, variant: Def["variant"], reasonLabel: string): Def => ({ key, label, variant, reasonRequired: true, reasonLabel, needsPanel: true });

function availableTransitions(a: ActionDetail): Def[] {
  const out: Def[] = [];
  const taskBacked = a.task_instance_id !== null;
  if (!a.owner_user_id && a.status !== "Closed" && a.status !== "Cancelled") {
    out.push(immediate("claim", "Claim", "secondary"));
  }
  switch (a.status) {
    case "New":
      out.push(immediate("start", "Start", "primary"));
      break;
    case "In Progress":
      out.push(withReason("waitInternal", "Wait (internal)", "secondary", "Reason for waiting"));
      out.push(withReason("waitCustomer", "Wait (customer)", "secondary", "Reason for waiting"));
      out.push(withReason("block", "Block", "secondary", "Blocking reason"));
      if (a.family === "APPROVAL") out.push(immediate("submitApproval", "Submit for approval", "primary"));
      if (!taskBacked) out.push(withNote("close", "Close", "primary", "Close note (optional)"));
      break;
    case "Waiting Internal":
      out.push(withReason("waitCustomer", "Switch to waiting on customer", "secondary", "Reason"));
      out.push(withReason("block", "Block", "secondary", "Blocking reason"));
      if (!taskBacked) out.push(withNote("close", "Close", "primary", "Close note (optional)"));
      break;
    case "Waiting Customer":
      out.push(withReason("waitInternal", "Switch to waiting internally", "secondary", "Reason"));
      out.push(withReason("block", "Block", "secondary", "Blocking reason"));
      if (!taskBacked) out.push(withNote("close", "Close", "primary", "Close note (optional)"));
      break;
    case "Blocked":
      out.push(immediate("unblock", "Unblock", "primary"));
      if (!taskBacked) out.push(withNote("close", "Close", "secondary", "Close note (optional)"));
      break;
    case "Ready for Approval":
      if (!taskBacked) out.push(withNote("approve", "Approve", "primary", "Approval note (optional)"));
      out.push(withReason("reject", "Reject", "danger", "Rejection reason"));
      break;
  }
  if (!taskBacked && a.status !== "Closed" && a.status !== "Cancelled") {
    out.push(withReason("cancel", "Cancel", "danger", "Cancellation reason"));
  }
  return out;
}

function run(id: string, key: Key, reason: string): Promise<void> {
  switch (key) {
    case "claim": return actionApi.claim(id);
    case "start": return actionApi.start(id);
    case "waitInternal": return actionApi.wait(id, "Waiting Internal", reason);
    case "waitCustomer": return actionApi.wait(id, "Waiting Customer", reason);
    case "block": return actionApi.block(id, reason);
    case "unblock": return actionApi.unblock(id);
    case "submitApproval": return actionApi.submitForApproval(id);
    case "approve": return actionApi.approve(id, reason || undefined);
    case "reject": return actionApi.reject(id, reason);
    case "close": return actionApi.close(id, reason || undefined);
    case "cancel": return actionApi.cancel(id, reason);
  }
}

export function TransitionActions({ action, onChanged }: { action: ActionDetail; onChanged: () => void }) {
  const [pending, setPending] = useState<Key | null>(null);
  const [reason, setReason] = useState("");
  const [firingKey, setFiringKey] = useState<Key | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A transition that lands successfully leaves `action` stale until the parent's onChanged()
  // refetch resolves and passes a new object down. Without this, the button group re-enables
  // against the old status for that window and a fast double-click re-sends the same transition
  // (e.g. a second /start on an action already In Progress) into a confusing 409/400 from the
  // server. Cleared only when a new `action` reference actually arrives, not on a timer.
  const [settling, setSettling] = useState(false);
  useEffect(() => setSettling(false), [action]);

  const defs = availableTransitions(action);
  const active = defs.find((d) => d.key === pending);

  async function fire(key: Key, reasonText: string) {
    setBusy(true);
    setFiringKey(key);
    setError(null);
    try {
      await run(action.id, key, reasonText);
      setPending(null);
      setReason("");
      setSettling(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    setFiringKey(null);
  }

  function confirm() {
    if (!active) return;
    if (active.reasonRequired && !reason.trim()) {
      setError("This needs a reason.");
      return;
    }
    void fire(active.key, reason.trim());
  }

  function click(d: Def) {
    if (busy || settling) return;
    if (!d.needsPanel) {
      void fire(d.key, "");
      return;
    }
    setPending(d.key);
    setReason("");
    setError(null);
  }

  if (defs.length === 0) return null;

  const groupDisabled = busy || settling;

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div role="group" aria-label="Available actions" className="flex flex-wrap gap-2">
        {defs.map((d) => (
          <Button key={d.key} size="sm" variant={d.variant} loading={firingKey === d.key} disabled={groupDisabled} onClick={() => click(d)}>
            {d.label}
          </Button>
        ))}
      </div>
      {error && !active && <p role="alert" className="text-footnote text-danger">{error}</p>}
      {active && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
          <Textarea
            placeholder={active.reasonLabel || "Note (optional)"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant={active.variant} onClick={confirm} loading={busy}>
              Confirm {active.label}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPending(null); setError(null); }} disabled={busy}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
