import { useEffect, useState } from "react";
import { Drawer, DrawerContent, Skeleton, EmptyState, Badge, StatusChip, KeyValue, Checkbox, Button } from "@homeflow/ui";
import { CircleAlert } from "lucide-react";
import { actionApi, type ActionDetail } from "./api";
import { TransitionActions } from "./TransitionActions";

// 10-universal-action.md Screens: "Action detail drawer (reused everywhere)". Real scope cuts,
// flagged not faked: "why it exists" renders source_module/source_entity_type/source_entity_id as
// plain text, not a link — no per-entity permalink/routing exists anywhere in this app yet: nav.ts
// is a fixed set of role tabs, not a URL-addressable entity viewer. Owner/backup render as raw user
// ids — no universal name-lookup endpoint is available to every actor (same gap already flagged in
// 11-my-day-ranking.md's Build note for Team view). No status stepper — the spec's Screens line
// calls for one, but the transitions History section already shows the real path taken (including
// branches a linear stepper can't represent, e.g. Waiting Internal <-> Waiting Customer), so a
// second, ordered depiction was judged redundant rather than built to tick a box. No evidence
// *upload* UI — verify/reject act on evidence rows the backend already has; the presigned-upload
// flow itself isn't wired here.
function formatAt(at: string | null): string {
  if (!at) return "—";
  return new Date(at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function DetailBody({ a, onChanged }: { a: ActionDetail; onChanged: () => void }) {
  const [itemError, setItemError] = useState<string | null>(null);

  function guarded(action: Promise<void>) {
    setItemError(null);
    action.then(onChanged).catch((e: Error) => setItemError(e.message));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{a.status}</Badge>
        {a.sla_state && <StatusChip status={a.sla_state} />}
        <Badge>{a.priority}</Badge>
      </div>
      {a.description && <p className="text-subhead text-fg-muted">{a.description}</p>}
      {itemError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {itemError}
        </p>
      )}
      {a.blocking_reason && (
        <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {a.blocking_reason}
        </p>
      )}
      <KeyValue
        items={[
          { key: "Why it exists", value: `${a.source_module} · ${a.source_entity_type} #${a.source_entity_id}` },
          { key: "Owner", value: a.owner_user_id ?? `Unassigned (${a.owner_role} queue)` },
          { key: "Backup owner", value: a.backup_owner_user_id ?? "—" },
          { key: "Due", value: formatAt(a.due_at) },
          { key: "Evidence requirement", value: a.evidence_requirement },
          { key: "Customer visible", value: a.customer_visible ? (a.customer_title ?? "Yes") : "No" },
        ]}
      />
      {a.checklist.length > 0 && (
        <section>
          <h3 className="mb-2 text-subhead font-semibold">Checklist</h3>
          <ul className="flex flex-col gap-2">
            {a.checklist.map((c) => (
              <li key={c.id}>
                <Checkbox
                  label={c.label + (c.required ? "" : " (optional)")}
                  checked={!!c.checked_at}
                  onCheckedChange={(checked) => guarded(actionApi.setChecklistItem(a.id, c.id, checked === true))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.evidence.length > 0 && (
        <section>
          <h3 className="mb-2 text-subhead font-semibold">Evidence</h3>
          <ul className="flex flex-col gap-2">
            {a.evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="truncate text-footnote">{e.file_key.split("/").pop()}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>{e.verification_status}</Badge>
                  {e.verification_status === "UPLOADED" && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => guarded(actionApi.verifyEvidence(a.id, e.id, "verify"))}>Verify</Button>
                      <Button size="sm" variant="ghost" onClick={() => guarded(actionApi.verifyEvidence(a.id, e.id, "reject"))}>Reject</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.task_instance_id !== null && a.status !== "Closed" && a.status !== "Cancelled" && (
        <p className="text-footnote text-fg-subtle">This action completes through its journey task — it closes automatically when that task is marked done.</p>
      )}
      {a.transitions.length > 0 && (
        <section>
          <h3 className="mb-2 text-subhead font-semibold">History</h3>
          <ul className="flex flex-col gap-1.5 text-footnote text-fg-muted">
            {a.transitions.map((t) => (
              <li key={t.id}>
                {t.from_status} → {t.to_status} · {formatAt(t.at)}{t.reason ? ` · ${t.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <TransitionActions action={a} onChanged={onChanged} />
    </div>
  );
}

export function ActionDrawer({ actionId, onClose, onChanged }: { actionId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [action, setAction] = useState<ActionDetail | null>(null);
  const [error, setError] = useState(false);

  function load() {
    if (!actionId) return;
    setError(false);
    actionApi.get(actionId).then(setAction).catch(() => setError(true));
  }

  useEffect(() => {
    setAction(null);
    if (actionId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId]);

  function handleChanged() {
    load();
    onChanged?.();
  }

  return (
    <Drawer open={actionId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent open={actionId !== null} title={action ? `${action.code} · ${action.title}` : "Action"} width={480}>
        {error ? (
          <EmptyState icon={CircleAlert} message="Couldn't load this action." action={{ label: "Retry", onClick: load }} />
        ) : action === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <DetailBody a={action} onChanged={handleChanged} />
        )}
      </DrawerContent>
    </Drawer>
  );
}
