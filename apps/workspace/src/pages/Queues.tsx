import { useEffect, useState } from "react";
import { PageHeader, Skeleton, EmptyState, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Button, Checkbox, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Inbox } from "lucide-react";
import { ApiError } from "../auth/api";
import { adminApi, type AdminUser } from "../auth/adminApi";
import { ActionDrawer } from "../components/ActionDrawer/ActionDrawer";
import { cn } from "../lib/utils";

// 10-universal-action.md Screens: "Departmental queues: role tabs, counts by status/SLA, claim
// button, bulk reassign (Management)." `listActions` gates on STAFF_ROLES only (any staff can
// browse any department's queue, same footprint as My Day) — bulk reassign is restricted
// client-side to Management/SUPER_ADMIN per the spec's own parenthetical, matching how My Day's
// own "Team view" is a client-side flag rather than a second backend role check.
// Status counts are derived client-side from the same project-scoped `listActions` rows, not
// from the `/api/queues/:role` view — that view has no project_id (it's a global count across
// every project), so badging off it while the row list below is project-scoped would show counts
// that disagree with what's rendered (caught in review before landing). No SLA data is returned
// by `listActions`, so "by SLA" from the spec line above is not implemented — flagged, not built.
type ActionStatus = "New" | "In Progress" | "Waiting Internal" | "Waiting Customer" | "Blocked" | "Ready for Approval" | "Closed" | "Cancelled";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface QueueAction {
  id: string;
  code: string;
  type: string;
  title: string;
  status: ActionStatus;
  priority: Priority;
  owner_user_id: string | null;
  owner_role: string;
  due_at: string | null;
  customer_visible: boolean;
  project_id: string | null;
}
// ROLE_CODES (pages/admin/roles.ts) minus MANAGEMENT/SUPER_ADMIN/CUSTOMER — those aren't
// action-owning departments (owner_role is always one of these on any seeded/created action).
const DEPARTMENTS: { role: string; label: string }[] = [
  { role: "SALES", label: "Sales" },
  { role: "CRM", label: "CRM / RM" },
  { role: "ACCOUNTS", label: "Accounts" },
  { role: "BANKING", label: "Banking" },
  { role: "LEGAL", label: "Legal" },
  { role: "REGISTRATION", label: "Registration" },
  { role: "SITE", label: "Site" },
  { role: "QA", label: "QA" },
  { role: "CUSTOMISATION", label: "Customisation" },
  { role: "FM", label: "FM" },
];

const OPEN_STATUSES: ActionStatus[] = ["New", "In Progress", "Waiting Internal", "Waiting Customer", "Blocked", "Ready for Approval"];

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}
function post(path: string, body?: unknown): Promise<void> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => unwrap(r));
}
const queuesApi = {
  listActions: (ownerRole: string, projectId?: string): Promise<QueueAction[]> =>
    fetch(`/api/actions?owner_role=${encodeURIComponent(ownerRole)}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`).then((r) => unwrap(r)),
  claim: (id: string) => post(`/api/actions/${id}/claim`),
  reassign: (id: string, ownerUserId: string) => post(`/api/actions/${id}/reassign`, { owner_user_id: ownerUserId }),
};

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

export function Queues({ projectId, roles }: { projectId: string; roles: string[] }) {
  const isManagement = roles.includes("MANAGEMENT") || roles.includes("SUPER_ADMIN");
  const [activeRole, setActiveRole] = useState(() => DEPARTMENTS.find((d) => roles.includes(d.role))?.role ?? DEPARTMENTS[0].role);
  const [rows, setRows] = useState<QueueAction[] | null>(null);
  const [error, setError] = useState(false);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignTo, setReassignTo] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  function load() {
    setError(false);
    setSelected(new Set());
    queuesApi
      .listActions(activeRole, projectId || undefined)
      .then(setRows)
      .catch(() => setError(true));
  }

  useEffect(() => {
    setRows(null);
    setNotice(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole, projectId]);

  useEffect(() => {
    if (isManagement) adminApi.listUsers().then(setUsers).catch(() => {});
  }, [isManagement]);

  const openRows = (rows ?? []).filter((r) => OPEN_STATUSES.includes(r.status));
  const counts = OPEN_STATUSES.map((status) => ({ status, count: openRows.filter((r) => r.status === status).length })).filter((c) => c.count > 0);
  const reassignOptions = users.filter((u) => u.roles.includes(activeRole));
  const departmentLabel = DEPARTMENTS.find((d) => d.role === activeRole)?.label ?? activeRole;

  async function handleClaim(id: string) {
    setNotice(null);
    try {
      await queuesApi.claim(id);
      load();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Couldn't claim this action." });
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkReassign() {
    if (!reassignTo || selected.size === 0) return;
    setBusy(true);
    setNotice(null);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => queuesApi.reassign(id, reassignTo)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setBusy(false);
    setReassignTo("");
    load();
    if (failed > 0) {
      setNotice({ tone: "error", text: `Reassigned ${ids.length - failed} of ${ids.length}; ${failed} failed (an action Ready for Approval can't be reassigned).` });
    } else {
      setNotice({ tone: "success", text: `Reassigned ${ids.length} action${ids.length === 1 ? "" : "s"} to the selected owner.` });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Departmental Queues" description="Open actions by department — claim unassigned work, reassign across the team." />

      {/* setRows(null) here, not just in the effect below: onValueChange and the effect commit in
          separate renders, so without this the new tab's panel would flash the previous tab's
          rows for a frame (reproduced via Playwright fast tab-cycling before this fix). */}
      <Tabs
        value={activeRole}
        onValueChange={(v) => {
          setRows(null);
          setActiveRole(v);
        }}
      >
        <TabsList className="flex-wrap">
          {DEPARTMENTS.map((d) => (
            <TabsTrigger key={d.role} value={d.role}>
              {d.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeRole}>
          {error ? (
            <EmptyState icon={Inbox} message="Couldn't load this queue." action={{ label: "Retry", onClick: load }} />
          ) : rows === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {counts.length === 0 ? (
                  <span className="text-footnote text-fg-subtle">No open actions.</span>
                ) : (
                  counts.map((c) => (
                    <Badge key={c.status}>
                      {c.status}: {c.count}
                    </Badge>
                  ))
                )}
              </div>

              {notice && (
                <p
                  role={notice.tone === "error" ? "alert" : "status"}
                  className={cn("rounded-lg px-3 py-2 text-footnote", notice.tone === "error" ? "bg-danger-soft text-danger-fg" : "bg-ok-soft text-ok-fg")}
                >
                  {notice.text}
                </p>
              )}

              {isManagement && openRows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-raised p-3">
                  <span className="text-footnote font-medium text-fg-muted">{selected.size} selected</span>
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger placeholder="Reassign to…" className="w-56" />
                    <SelectOptions options={reassignOptions.map((u) => ({ value: u.id, label: u.display_name }))} />
                  </Select>
                  <Button size="sm" disabled={selected.size === 0 || !reassignTo || busy} onClick={handleBulkReassign}>
                    Reassign {selected.size > 0 ? selected.size : ""}
                  </Button>
                </div>
              )}

              {openRows.length === 0 ? (
                <EmptyState icon={Inbox} message={`No open actions in ${departmentLabel}.`} />
              ) : (
                <ul className="flex flex-col">
                  {openRows.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                      {isManagement && <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggleSelected(a.id)} aria-label={`Select ${a.code} for reassignment`} />}
                      <button
                        type="button"
                        onClick={() => setOpenActionId(a.id)}
                        className="min-w-0 flex-1 rounded-lg text-left transition-colors duration-micro hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-caption text-fg-subtle">{a.code}</span>
                            <div className="truncate text-subhead font-semibold">{a.title}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {a.due_at && <span className="text-footnote text-fg-subtle">{formatDue(a.due_at)}</span>}
                            <Badge>{a.priority}</Badge>
                            <Badge>{a.status}</Badge>
                          </div>
                        </div>
                        {/* Raw user id, not a display name — same known gap as ActionDrawer's Owner field
                            (no universal name-lookup endpoint available to every actor yet). */}
                        <p className="text-footnote text-fg-muted">{a.owner_user_id ? `Owned by ${a.owner_user_id}` : `Unassigned (${departmentLabel} queue)`}</p>
                      </button>
                      {!a.owner_user_id && (
                        <Button size="sm" variant="secondary" onClick={() => handleClaim(a.id)}>
                          Claim
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ActionDrawer actionId={openActionId} onClose={() => setOpenActionId(null)} onChanged={load} />
    </div>
  );
}
