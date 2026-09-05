import { useEffect, useMemo, useState } from "react";
import { adminApi, type PermissionRow } from "../../auth/adminApi";
import { ApiError } from "../../auth/api";
import { Button } from "@homeflow/ui";
import { ROLE_CODES } from "./roles";

const LEVELS = ["NONE", "READ_STATUS_ONLY", "READ_LIMITED", "READ", "WRITE", "ADMIN"] as const;
const selectCls = "rounded-md border border-line bg-surface px-1.5 py-1 text-caption outline-none focus-visible:border-accent";

/** Admin → Permission matrix (role × module grid, effective date, change log). */
export function AdminPermissionMatrix() {
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({}); // "ROLE|module" -> level
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    adminApi
      .getPermissionMatrix()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the permission matrix."));
  }
  useEffect(load, []);

  const current = useMemo(() => {
    const map = new Map<string, PermissionRow>();
    for (const r of rows ?? []) {
      if (r.effective_to) continue; // only the open (current) row per role/module
      map.set(`${r.role_code}|${r.module}`, r);
    }
    return map;
  }, [rows]);

  const modules = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.module))).sort(), [rows]);

  function levelFor(role: string, module: string): string {
    const key = `${role}|${module}`;
    return pending[key] ?? current.get(key)?.level ?? "NONE";
  }

  function setLevel(role: string, module: string, level: string) {
    setPending((p) => ({ ...p, [`${role}|${module}`]: level }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const changes = Object.entries(pending).map(([key, level]) => {
        const [role_code, module] = key.split("|");
        return { role_code, module, level };
      });
      await adminApi.putPermissionMatrix(changes);
      setPending({});
      load();
    } catch (e) {
      setSaveError(e instanceof ApiError && e.code === "forbidden" ? "Only Super Admin can change the permission matrix." : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = Object.keys(pending).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-title1 font-bold tracking-tight">Permission matrix</h1>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : dirty ? `Save ${Object.keys(pending).length} change(s)` : "No changes"}
        </Button>
      </div>
      {saveError && (
        <p role="alert" className="text-footnote font-medium text-overdue">
          {saveError}
        </p>
      )}
      {error && <p className="text-subhead text-overdue">{error}</p>}
      {!error && rows === null && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
      {rows && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-caption">
            <thead className="sticky top-0 bg-surface-2 text-footnote">
              <tr>
                <th className="p-2">Module</th>
                {ROLE_CODES.map((role) => (
                  <th key={role} className="p-2 text-center">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module} className="border-t border-line">
                  <td className="whitespace-nowrap p-2 font-medium">{module}</td>
                  {ROLE_CODES.map((role) => (
                    <td key={role} className="p-1 text-center">
                      <select
                        aria-label={`${role} × ${module}`}
                        className={selectCls}
                        value={levelFor(role, module)}
                        onChange={(e) => setLevel(role, module, e.target.value)}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
