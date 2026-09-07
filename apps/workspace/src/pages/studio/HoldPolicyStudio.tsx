import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Settings2 } from "lucide-react";
import { api, type Project } from "../../api";
import { salesApi, type HoldPolicy } from "../sales/api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL } from "../sales/labels";

const APPROVER_ROLES = ["SITE", "MANAGEMENT", "SALES", "CRM"]; // real seeded department roles a hold approval can be routed to

/** 24-sales-inventory-discovery.md rule 6's own Studio config — "Hold policy" (max days, max
 *  active per project, allowed categories, approver role). Standard (project_id null) row plus
 *  a per-project override, same pattern as 18's CustomisationPolicyStudio. */
export function HoldPolicyStudio({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [policy, setPolicy] = useState<HoldPolicy | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects);
  }, []);

  function load() {
    setError(false);
    setPolicy(null);
    salesApi.getHoldPolicy(projectId || null).then(setPolicy).catch(() => setError(true));
  }
  useEffect(load, [projectId]);

  async function save() {
    if (!policy) return;
    setSaving(true);
    setSaveError(null);
    try {
      setPolicy(await salesApi.putHoldPolicy({ ...policy, project_id: projectId || null }));
    } catch {
      setSaveError("Couldn't save the hold policy.");
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(c: string) {
    if (!policy) return;
    const cur = policy.allowed_categories ?? [];
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    setPolicy({ ...policy, allowed_categories: next.length === 0 ? null : next });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Hold policy" description="24-sales-inventory-discovery.md rule 6 — Change Window Hold limits: max days, max active per project, allowed categories, approver role." />
      <Field label="Scope" htmlFor="hp-project" hint="Standard applies to every project without its own override.">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger id="hp-project" placeholder="Standard (all projects)" />
          <SelectOptions options={[{ value: "", label: "Standard (all projects)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        </Select>
      </Field>

      {error && <EmptyState icon={Settings2} message="Couldn't load the hold policy." action={{ label: "Retry", onClick: load }} />}
      {!error && policy === null && <Skeleton />}
      {!error && policy && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Max days" htmlFor="hp-max-days">
              <Input id="hp-max-days" type="number" min={1} value={policy.max_days} onChange={(e) => setPolicy({ ...policy, max_days: Number(e.target.value) || 1 })} disabled={!canEdit} />
            </Field>
            <Field label="Max active per project" htmlFor="hp-max-active">
              <Input id="hp-max-active" type="number" min={1} value={policy.max_active_per_project} onChange={(e) => setPolicy({ ...policy, max_active_per_project: Number(e.target.value) || 1 })} disabled={!canEdit} />
            </Field>
            <Field label="Approver role" htmlFor="hp-approver">
              <Select value={policy.approver_role} onValueChange={(v) => setPolicy({ ...policy, approver_role: v })} disabled={!canEdit}>
                <SelectTrigger id="hp-approver" />
                <SelectOptions options={APPROVER_ROLES.map((r) => ({ value: r, label: r }))} />
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-footnote text-fg">
            <input type="checkbox" checked={policy.auto_expire} onChange={(e) => setPolicy({ ...policy, auto_expire: e.target.checked })} disabled={!canEdit} />
            Auto-expire holds past their approved date
          </label>
          <div>
            <h3 className="mb-2 text-ws-sm font-medium text-fg">Allowed categories</h3>
            <p className="mb-2 text-caption text-fg-subtle">None selected means every category may be held.</p>
            <div className="flex flex-wrap gap-2">
              {CHANGE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleCategory(c)}
                  aria-pressed={(policy.allowed_categories ?? []).includes(c)}
                  className={
                    (policy.allowed_categories ?? []).includes(c)
                      ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-footnote font-medium text-accent"
                      : "rounded-full border border-line bg-surface px-3 py-1 text-footnote font-medium text-fg-muted"
                  }
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save hold policy"}</Button>}
        </div>
      )}
    </div>
  );
}
