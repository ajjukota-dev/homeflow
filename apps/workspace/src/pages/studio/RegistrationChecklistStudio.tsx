import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { ClipboardCheck, Trash2 } from "lucide-react";
import { api, type Project } from "../../api";
import { registrationApi, type ChecklistTemplate, type ChecklistItem } from "../registration/api";

const GLOBAL = "__global__";

/** 23-registration.md Screens: "Policy Studio → Registration checklists". registry.ts's own
 *  "23.registration_checklists" tab (built:true server-side, no frontend until now). One
 *  registration_checklist_template row per (project_id, jurisdiction) scope — same upsert-by-scope
 *  shape 18's cr_approval_rule uses. PUT replaces the whole row, so sro_offices/jurisdiction_lead_days
 *  (owned by SroOfficesStudio) are always round-tripped unchanged from the loaded row. */
export function RegistrationChecklistStudio({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null);
  const [error, setError] = useState(false);
  const [scopeId, setScopeId] = useState<string>(GLOBAL);
  const [projectId, setProjectId] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [preItems, setPreItems] = useState<ChecklistItem[]>([]);
  const [dayOfItems, setDayOfItems] = useState<ChecklistItem[]>([]);
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
  // scope loaded silently empty even when its row has real items.
  useEffect(() => {
    if (templates && scopeId !== "__new__") selectScope(scopeId === GLOBAL ? GLOBAL : (templates.some((t) => t.id === scopeId) ? scopeId : GLOBAL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function selectScope(id: string) {
    setScopeId(id);
    setSaveError(null);
    if (id === GLOBAL) {
      const t = templates?.find((x) => x.project_id === null && x.jurisdiction === null);
      setProjectId(""); setJurisdiction(""); setPreItems(t?.pre_items ?? []); setDayOfItems(t?.day_of_items ?? []);
      return;
    }
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    setProjectId(t.project_id ?? ""); setJurisdiction(t.jurisdiction ?? ""); setPreItems(t.pre_items); setDayOfItems(t.day_of_items);
  }

  function newScope() {
    setScopeId("__new__");
    setSaveError(null);
    setProjectId(projects?.[0]?.id ?? "");
    setJurisdiction("");
    setPreItems([]);
    setDayOfItems([]);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const existing = scopeId !== GLOBAL && scopeId !== "__new__" ? templates?.find((x) => x.id === scopeId) : templates?.find((x) => x.project_id === null && x.jurisdiction === null);
    try {
      const saved = await registrationApi.putChecklistTemplate({
        project_id: scopeId === GLOBAL ? null : projectId || null,
        jurisdiction: scopeId === GLOBAL ? null : jurisdiction.trim() || null,
        pre_items: preItems.filter((i) => i.key.trim() && i.label.trim()),
        day_of_items: dayOfItems.filter((i) => i.key.trim() && i.label.trim()),
        sro_offices: existing?.sro_offices ?? [],
        jurisdiction_lead_days: existing?.jurisdiction_lead_days ?? 15,
      });
      // Keep the GLOBAL sentinel selected after saving the global scope — `saved.id` is the row's
      // real db id, which doesn't match any option's value once scopeOptions filters that row out.
      setScopeId(scopeId === GLOBAL ? GLOBAL : saved.id);
      // Merge the saved row locally instead of calling load() — a re-fetch here raced a fast
      // follow-up edit: the in-flight GET could resolve AFTER the user's next edit and the
      // [templates] effect below would stomp it back to the pre-edit value (same class of bug
      // found live in SroOfficesStudio.tsx's delete-then-save round trip).
      setTemplates((prev) => (prev ? (prev.some((t) => t.id === saved.id) ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved]) : prev));
    } catch {
      setSaveError("Couldn't save the checklist.");
    } finally {
      setSaving(false);
    }
  }

  function itemsEditor(items: ChecklistItem[], setItems: (i: ChecklistItem[]) => void, addLabel: string) {
    return (
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input value={it.key} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))} placeholder="key (e.g. tds_paid)" />
            <Input value={it.label} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} placeholder="label shown to staff" />
            <Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setItems([...items, { key: "", label: "" }])}>{addLabel}</Button>
      </div>
    );
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
        title="Registration checklists"
        description="23-registration.md — pre-registration and day-of checklist items, scoped by project or jurisdiction (falls back to the global default). recordExecution() blocks EXECUTED until every day-of item here is checked."
        actions={canEdit ? <Button onClick={newScope}>+ New scope</Button> : undefined}
      />

      {error && <EmptyState icon={ClipboardCheck} message="Couldn't load registration checklists." action={{ label: "Retry", onClick: load }} />}
      {!error && (templates === null || projects === null) && <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>}

      {!error && templates !== null && projects !== null && (
        <>
          <Field label="Scope" htmlFor="regchk-scope">
            <Select value={scopeId === "__new__" ? scopeId : scopeId} onValueChange={selectScope} disabled={scopeId === "__new__"}>
              <SelectTrigger id="regchk-scope" />
              <SelectOptions options={scopeId === "__new__" ? [{ value: "__new__", label: "New scope (unsaved)" }] : scopeOptions} />
            </Select>
          </Field>

          {scopeId === "__new__" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Project (optional — leave unset for a jurisdiction-wide default)" htmlFor="regchk-project">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="regchk-project" placeholder="No project" />
                  <SelectOptions options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                </Select>
              </Field>
              <Field label="Jurisdiction (optional)" htmlFor="regchk-jurisdiction">
                <Input id="regchk-jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Karnataka" />
              </Field>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Pre-registration checklist</h3>
            {itemsEditor(preItems, setPreItems, "+ Add pre-registration item")}
          </div>
          <div>
            <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Day-of checklist</h3>
            {itemsEditor(dayOfItems, setDayOfItems, "+ Add day-of item")}
          </div>

          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && <Button className="self-start" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>}
        </>
      )}
    </div>
  );
}
