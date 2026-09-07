import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { Landmark, Trash2 } from "lucide-react";
import { api, type Project } from "../../api";
import { registrationApi, type ChecklistTemplate } from "../registration/api";

const GLOBAL = "__global__";

/** 23-registration.md Screens: "Policy Studio → SRO offices". registry.ts's own "23.sro_offices"
 *  tab (built:true server-side, no frontend until now). sro_offices ships EMPTY on every seeded
 *  template (this spec's own Build note) — CaseDrawer's SlotPanel falls back to a free-text field
 *  until a project/jurisdiction is configured here. Same one-table-two-screens split as
 *  RegistrationChecklistStudio.tsx — PUT round-trips pre_items/day_of_items unchanged. */
export function SroOfficesStudio({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null);
  const [error, setError] = useState(false);
  const [scopeId, setScopeId] = useState<string>(GLOBAL);
  const [projectId, setProjectId] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [offices, setOffices] = useState<string[]>([]);
  const [leadDays, setLeadDays] = useState("15");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    Promise.all([api.listProjects(), registrationApi.listChecklistTemplates()])
      .then(([p, t]) => { setProjects(p); setTemplates(t); })
      .catch(() => setError(true));
  }
  useEffect(load, []);

  // Populate the form once templates arrive (and after any save/reload) — the Select's own
  // onValueChange only fires on user interaction, so without this the initial "Global default"
  // scope loaded silently empty even when its row has real offices.
  useEffect(() => {
    if (templates && scopeId !== "__new__") selectScope(scopeId === GLOBAL ? GLOBAL : (templates.some((t) => t.id === scopeId) ? scopeId : GLOBAL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function selectScope(id: string) {
    setScopeId(id);
    setSaveError(null);
    if (id === GLOBAL) {
      const t = templates?.find((x) => x.project_id === null && x.jurisdiction === null);
      setProjectId(""); setJurisdiction(""); setOffices(t?.sro_offices ?? []); setLeadDays((t?.jurisdiction_lead_days ?? 15).toString());
      return;
    }
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setProjectId(t.project_id ?? ""); setJurisdiction(t.jurisdiction ?? ""); setOffices(t.sro_offices); setLeadDays(t.jurisdiction_lead_days.toString());
  }

  function newScope() {
    setScopeId("__new__");
    setSaveError(null);
    setProjectId(projects?.[0]?.id ?? "");
    setJurisdiction("");
    setOffices([]);
    setLeadDays("15");
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const existing = scopeId !== GLOBAL && scopeId !== "__new__" ? templates?.find((x) => x.id === scopeId) : templates?.find((x) => x.project_id === null && x.jurisdiction === null);
    try {
      const saved = await registrationApi.putChecklistTemplate({
        project_id: scopeId === GLOBAL ? null : projectId || null,
        jurisdiction: scopeId === GLOBAL ? null : jurisdiction.trim() || null,
        pre_items: existing?.pre_items ?? [],
        day_of_items: existing?.day_of_items ?? [],
        sro_offices: offices.map((o) => o.trim()).filter(Boolean),
        jurisdiction_lead_days: Number(leadDays) || 0,
      });
      // Keep the GLOBAL sentinel selected after saving the global scope — `saved.id` is the row's
      // real db id, which doesn't match any option's value once scopeOptions filters that row out.
      setScopeId(scopeId === GLOBAL ? GLOBAL : saved.id);
      load();
    } catch {
      setSaveError("Couldn't save SRO offices.");
    } finally {
      setSaving(false);
    }
  }

  const scopeOptions = [
    { value: GLOBAL, label: "Global default" },
    ...(templates ?? []).filter((t) => t.project_id !== null || t.jurisdiction !== null).map((t) => ({
      value: t.id,
      label: t.project_id ? `Project: ${projects?.find((p) => p.id === t.project_id)?.name ?? t.project_id}` : `Jurisdiction: ${t.jurisdiction}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="SRO offices"
        description="23-registration.md — the SRO office list a registration slot can be booked against, plus the jurisdiction lead time added to every forecast date. Empty until configured — the Registration desk falls back to free text until then."
        actions={canEdit ? <Button onClick={newScope}>+ New scope</Button> : undefined}
      />

      {error && <EmptyState icon={Landmark} message="Couldn't load SRO offices." action={{ label: "Retry", onClick: load }} />}
      {!error && (templates === null || projects === null) && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>}

      {!error && templates !== null && projects !== null && (
        <>
          <Field label="Scope" htmlFor="sro-scope">
            <Select value={scopeId} onValueChange={selectScope} disabled={scopeId === "__new__"}>
              <SelectTrigger id="sro-scope" />
              <SelectOptions options={scopeId === "__new__" ? [{ value: "__new__", label: "New scope (unsaved)" }] : scopeOptions} />
            </Select>
          </Field>

          {scopeId === "__new__" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Project (optional — leave unset for a jurisdiction-wide default)" htmlFor="sro-project">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="sro-project" placeholder="No project" />
                  <SelectOptions options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                </Select>
              </Field>
              <Field label="Jurisdiction (optional)" htmlFor="sro-jurisdiction">
                <Input id="sro-jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Karnataka" />
              </Field>
            </div>
          )}

          <Field label="Jurisdiction lead days (added to the forecast date)" htmlFor="sro-lead-days">
            <Input id="sro-lead-days" type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
          </Field>

          <div>
            <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">SRO offices</h3>
            <div className="flex flex-col gap-2">
              {offices.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={o} onChange={(e) => setOffices(offices.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="e.g. SRO Bengaluru North" />
                  <Button variant="ghost" size="sm" onClick={() => setOffices(offices.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setOffices([...offices, ""])}>+ Add office</Button>
            </div>
          </div>

          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button className="self-start" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>}
        </>
      )}
    </div>
  );
}
