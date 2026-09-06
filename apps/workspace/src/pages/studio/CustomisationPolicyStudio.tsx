import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Settings2 } from "lucide-react";
import { api, type Project } from "../../api";
import { changeRequestsApi, type CustomisationPolicy } from "../customisation/api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL } from "../customisation/labels";

/** 18-change-requests.md Screens: "Studio tabs: Customisation policy (freeze dates, validity,
 *  payment gate %, cancellation terms)" — per-project, so this tab needs its own project picker
 *  (unlike the approval matrix, which is standard-scope only). */
export function CustomisationPolicyStudio({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [policy, setPolicy] = useState<CustomisationPolicy | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      setProjectId((cur) => cur || ps[0]?.id || "");
    });
  }, []);

  function load() {
    if (!projectId) return;
    setError(false);
    changeRequestsApi.policy(projectId).then(setPolicy).catch(() => setError(true));
  }
  useEffect(load, [projectId]);

  async function save() {
    if (!policy) return;
    setSaving(true);
    setSaveError(null);
    try {
      setPolicy(await changeRequestsApi.putPolicy(projectId, policy));
    } catch {
      setSaveError("Couldn't save the policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Customisation policy" description="18-change-requests.md — freeze dates by category, quotation validity, payment gate %, catalogue-only flag." />
      <Field label="Project" htmlFor="cp-project">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger id="cp-project" />
          <SelectOptions options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Select>
      </Field>

      {error && <EmptyState icon={Settings2} message="Couldn't load this project's policy." action={{ label: "Retry", onClick: load }} />}
      {!error && policy === null && <Skeleton />}
      {!error && policy && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Quotation validity (days)" htmlFor="cp-validity">
              <Input id="cp-validity" type="number" min={1} value={policy.quotation_validity_days} onChange={(e) => setPolicy({ ...policy, quotation_validity_days: Number(e.target.value) || 1 })} disabled={!canEdit} />
            </Field>
            <Field label="Payment gate (%)" htmlFor="cp-gate-pct" hint="UNCONFIRMED default (100%) — p12's own TODO §8 client question, unresolved.">
              <Input id="cp-gate-pct" type="number" min={0} max={100} value={policy.payment_gate_pct} onChange={(e) => setPolicy({ ...policy, payment_gate_pct: Number(e.target.value) || 0 })} disabled={!canEdit} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-footnote text-fg">
            <input type="checkbox" checked={policy.allowed_catalogue_only} onChange={(e) => setPolicy({ ...policy, allowed_catalogue_only: e.target.checked })} disabled={!canEdit} />
            Catalogue items only (no bespoke line items)
          </label>
          <div>
            <h3 className="mb-2 text-ws-sm font-medium text-fg">Freeze dates by category</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHANGE_CATEGORIES.map((c) => (
                <Field key={c} label={CATEGORY_LABEL[c]} htmlFor={`cp-freeze-${c}`}>
                  <Input
                    id={`cp-freeze-${c}`}
                    type="date"
                    value={policy.freeze_dates[c] ?? ""}
                    onChange={(e) => setPolicy({ ...policy, freeze_dates: { ...policy.freeze_dates, [c]: e.target.value } })}
                    disabled={!canEdit}
                  />
                </Field>
              ))}
            </div>
          </div>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save policy"}</Button>}
        </div>
      )}
    </div>
  );
}
