import { useEffect, useState, type FormEvent } from "react";
import { adminApi, type Assignment } from "../../auth/adminApi";
import { ApiError } from "../../auth/api";
import { Button, Card, CardBody, CardHeader } from "@homeflow/ui";

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus-visible:border-accent";
const DEPARTMENTS = ["SALES", "CRM", "ACCOUNTS", "BANKING", "LEGAL", "REGISTRATION", "PROJECTS", "QA", "CUSTOMISATION", "HANDOVER", "FACILITY", "MANAGEMENT"];

/** Admin → Teams & Assignments (p36 §31.1): per-project, effective-dated. */
export function AdminTeams({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    if (!projectId) return;
    adminApi
      .listAssignments(projectId)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load assignments."));
  }

  useEffect(load, [projectId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!userId.trim()) return setFormError("A user id is required.");
    setBusy(true);
    try {
      await adminApi.createAssignment({
        project_id: projectId,
        user_id: userId.trim(),
        department,
        role_scope: department,
        assignment_type: "DEDICATED",
        is_primary_owner: true,
        is_backup_owner: false,
        effective_from: effectiveFrom,
        effective_to: null,
        capacity_pct: 100,
        team_id: null,
        escalation_manager_user_id: null,
      });
      setUserId("");
      setFormOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't create the assignment.");
    } finally {
      setBusy(false);
    }
  }

  async function end(row: Assignment) {
    await adminApi.updateAssignment(row.id, { effective_to: new Date().toISOString().slice(0, 10) });
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-title1 font-bold tracking-tight">Teams &amp; assignments</h1>
        <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? "Cancel" : "New assignment"}</Button>
      </div>

      {formOpen && (
        <Card>
          <CardBody>
            <form className="flex flex-col gap-3" onSubmit={create} noValidate>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-subhead font-medium">
                  User id
                  <input className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} disabled={busy} />
                </label>
                <label className="flex flex-col gap-1 text-subhead font-medium">
                  Department
                  <select className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)} disabled={busy}>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-subhead font-medium">
                  Effective from
                  <input className={inputCls} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={busy} />
                </label>
              </div>
              {formError && (
                <p role="alert" className="text-footnote font-medium text-overdue">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Saving…" : "Add assignment"}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-title3 font-semibold">Assignments</h2>
        </CardHeader>
        <CardBody>
          {error && <p className="text-subhead text-overdue">{error}</p>}
          {!error && rows === null && <div className="h-24 animate-pulse rounded-lg bg-surface-2" />}
          {rows?.length === 0 && <p className="text-subhead text-fg-muted">No assignments for this project yet.</p>}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-subhead">
                <thead className="text-footnote text-fg-subtle">
                  <tr>
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2 pr-4">Department</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Effective from</th>
                    <th className="pb-2 pr-4">Effective to</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-2 pr-4 font-medium">{r.user_id}</td>
                      <td className="py-2 pr-4 text-fg-muted">{r.department}</td>
                      <td className="py-2 pr-4 text-fg-muted">{r.assignment_type}</td>
                      <td className="py-2 pr-4 text-fg-muted">{String(r.effective_from).slice(0, 10)}</td>
                      <td className="py-2 pr-4 text-fg-muted">{r.effective_to ? String(r.effective_to).slice(0, 10) : "—"}</td>
                      <td className="py-2 text-right">
                        {!r.effective_to && (
                          <Button size="sm" variant="secondary" onClick={() => end(r)}>
                            End
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
