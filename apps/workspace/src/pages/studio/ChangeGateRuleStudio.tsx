import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions, Dialog, DialogContent } from "@homeflow/ui";
import { GitBranch, Trash2 } from "lucide-react";
import { api, type Project } from "../../api";
import { modelApi, type AdminUnit } from "../../api-model";
import { changeabilityApi, type RuleInput, type RuleRow, type GateState } from "../site/changeability-api";
import { GateChip } from "../../ui/GateChip";

// 08-changeability-engine.md Screens: "Policy Studio -> Change Gate Rule Studio" — its own
// bespoke DRAFT/PUBLISHED/RETIRED versioning (changeability/core.ts), distinct from
// 08.change_categories' plain generic-envelope table. Standard (project_id null) scope only, same
// scope cut 18's CustomisationApprovalMatrixStudio already made for its own approval matrix.

// The real seeded 4-code lists (07/08's own backend build notes: the spec's own long
// uppercase example lists were never seeded) — same small-duplicated-constant pattern already
// established for 18's CHANGE_CATEGORIES/CATEGORY_LABEL.
const CATEGORIES = ["kitchen_layout", "electrical", "flooring_selection", "structural"] as const;
const CATEGORY_LABEL: Record<string, string> = { kitchen_layout: "Kitchen layout", electrical: "Electrical", flooring_selection: "Flooring selection", structural: "Structural" };
const COMPONENTS = ["structure", "mep_first_fix", "flooring", "finishing"] as const;
const COMPONENT_LABEL: Record<string, string> = { structure: "Structure", mep_first_fix: "MEP first fix", flooring: "Flooring", finishing: "Finishing" };
const PROGRESS_STATES = ["not_started", "in_progress", "complete", "verified", "rework"] as const;
const RESULTING_STATES: GateState[] = ["OPEN", "CLOSING", "CONDITIONAL", "EXCEPTION_ONLY", "HARD_CLOSED"];

type Draft = RuleInput;
function blank(): Draft {
  return { category_code: CATEGORIES[0], trigger_component_code: COMPONENTS[0], min_state: "complete", resulting_state: "CLOSING", hard_or_soft: "HARD", closing_lead_days: 14, exception_authority_role: "MANAGEMENT", priority: 0 };
}

export function ChangeGateRuleStudio({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [published, setPublished] = useState<RuleRow[]>([]);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReason, setPublishReason] = useState("");

  function load() {
    setError(false);
    changeabilityApi
      .listRules(null, "PUBLISHED")
      .then((r) => {
        setPublished(r);
        setRows(r.map((x) => ({ category_code: x.category_code, trigger_component_code: x.trigger_component_code, min_state: x.min_state, trigger_event: x.trigger_event, resulting_state: x.resulting_state, hard_or_soft: x.hard_or_soft, closing_lead_days: x.closing_lead_days, exception_authority_role: x.exception_authority_role, priority: x.priority })));
      })
      .catch(() => setError(true));
  }
  useEffect(load, []);

  function update(i: number, patch: Partial<Draft>) {
    setRows((r) => r!.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function saveDraft() {
    if (!rows || rows.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await changeabilityApi.putRules(null, rows);
      setPublishOpen(true);
    } catch {
      setSaveError("Couldn't save the draft.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!publishReason.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await changeabilityApi.publishRules(null, publishReason.trim());
      setPublishOpen(false);
      setPublishReason("");
      load();
    } catch {
      setSaveError("Couldn't publish. A DRAFT must exist first — try Save draft again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Change Gate Rule Studio"
        description="08-changeability-engine.md rule 3/6 — the standard rule set. Editing creates a new DRAFT; publishing (with a reason) retires the current PUBLISHED set and re-evaluates every unit."
      />

      {error && <EmptyState icon={GitBranch} message="Couldn't load change gate rules." action={{ label: "Retry", onClick: load }} />}
      {!error && rows === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && rows !== null && (
        <>
          {published.length > 0 && (
            <p className="text-footnote text-fg-muted">
              Currently PUBLISHED v{published[0]!.version}
              {published[0]!.publish_reason ? ` — "${published[0]!.publish_reason}"` : ""}.
            </p>
          )}
          {rows.length === 0 && <p className="text-footnote text-fg-muted">No rules yet.</p>}
          <div className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Category" htmlFor={`cgr-cat-${i}`}>
                    <Select value={r.category_code} onValueChange={(v) => update(i, { category_code: v })} disabled={!canEdit}>
                      <SelectTrigger id={`cgr-cat-${i}`} />
                      <SelectOptions options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
                    </Select>
                  </Field>
                  <Field label="Trigger component" htmlFor={`cgr-comp-${i}`}>
                    <Select value={r.trigger_component_code} onValueChange={(v) => update(i, { trigger_component_code: v })} disabled={!canEdit}>
                      <SelectTrigger id={`cgr-comp-${i}`} />
                      <SelectOptions options={COMPONENTS.map((c) => ({ value: c, label: COMPONENT_LABEL[c] }))} />
                    </Select>
                  </Field>
                  <Field label="Min progress state" htmlFor={`cgr-min-${i}`}>
                    <Select value={r.min_state ?? ""} onValueChange={(v) => update(i, { min_state: v })} disabled={!canEdit}>
                      <SelectTrigger id={`cgr-min-${i}`} />
                      <SelectOptions options={PROGRESS_STATES.map((s) => ({ value: s, label: s }))} />
                    </Select>
                  </Field>
                  <Field label="Resulting state" htmlFor={`cgr-res-${i}`}>
                    <Select value={r.resulting_state} onValueChange={(v) => update(i, { resulting_state: v as GateState })} disabled={!canEdit}>
                      <SelectTrigger id={`cgr-res-${i}`} />
                      <SelectOptions options={RESULTING_STATES.map((s) => ({ value: s, label: s }))} />
                    </Select>
                  </Field>
                  <Field label="Hard/soft" htmlFor={`cgr-hs-${i}`}>
                    <Select value={r.hard_or_soft ?? "HARD"} onValueChange={(v) => update(i, { hard_or_soft: v as "HARD" | "SOFT" })} disabled={!canEdit}>
                      <SelectTrigger id={`cgr-hs-${i}`} />
                      <SelectOptions options={[{ value: "HARD", label: "Hard" }, { value: "SOFT", label: "Soft" }]} />
                    </Select>
                  </Field>
                  <Field label="Closing lead days" htmlFor={`cgr-lead-${i}`}>
                    <Input id={`cgr-lead-${i}`} type="number" value={r.closing_lead_days ?? 14} onChange={(e) => update(i, { closing_lead_days: Number(e.target.value) })} disabled={!canEdit} />
                  </Field>
                  <Field label="Exception authority" htmlFor={`cgr-auth-${i}`}>
                    <Input id={`cgr-auth-${i}`} value={r.exception_authority_role ?? "MANAGEMENT"} onChange={(e) => update(i, { exception_authority_role: e.target.value.toUpperCase() })} disabled={!canEdit} />
                  </Field>
                  <Field label="Priority" htmlFor={`cgr-pri-${i}`}>
                    <Input id={`cgr-pri-${i}`} type="number" value={r.priority ?? 0} onChange={(e) => update(i, { priority: Number(e.target.value) })} disabled={!canEdit} />
                  </Field>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRows((rr) => rr!.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRows((rs) => [...(rs ?? []), blank()])}>+ Add rule</Button>
              <Button onClick={saveDraft} disabled={saving || rows.length === 0}>{saving ? "Saving…" : "Save draft & publish…"}</Button>
            </div>
          )}
        </>
      )}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent title="Publish this rule set" description="Rule 6: publishing always requires a reason. Every unit is re-evaluated against the new rules immediately.">
          <div className="flex flex-col gap-3">
            <label className="text-footnote font-medium text-fg-muted">
              Reason (required)
              <textarea value={publishReason} onChange={(e) => setPublishReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
            </label>
            {saveError && <p role="alert" className="text-footnote text-overdue">{saveError}</p>}
            <Button onClick={publish} disabled={!publishReason.trim() || saving}>{saving ? "Publishing…" : "Publish"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <SimulationPanel />
    </div>
  );
}

/** Rule 10's dry-run: pick a real unit, override components, see the resulting states —
 *  no fictional data, always against a real seeded unit's real current facts. */
function SimulationPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ category_code: string; state: GateState; reason_text: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => {
    if (!projectId) return setUnits([]);
    modelApi.listProjectUnits(projectId).then(setUnits).catch(() => setUnits([]));
  }, [projectId]);

  async function simulate() {
    if (!unitId) return;
    setBusy(true);
    setSimError(null);
    try {
      const m = await changeabilityApi.evaluate(unitId, overrides);
      setResult(m.gates.map((g) => ({ category_code: g.category_code, state: g.state, reason_text: g.reason_text })));
    } catch {
      setSimError("Couldn't simulate.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <h2 className="text-title3 font-semibold">Simulation</h2>
      <p className="mt-1 text-footnote text-fg-muted">Pick a real unit, optionally override a component's progress state, and see the resulting gate states — a dry run, nothing is saved.</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Project" htmlFor="sim-project">
          <Select value={projectId} onValueChange={(v) => { setProjectId(v); setUnitId(""); setResult(null); }}>
            <SelectTrigger id="sim-project" placeholder="Select a project" />
            <SelectOptions options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </Select>
        </Field>
        <Field label="Unit" htmlFor="sim-unit">
          <Select value={unitId} onValueChange={(v) => { setUnitId(v); setResult(null); }}>
            <SelectTrigger id="sim-unit" placeholder="Select a unit" />
            <SelectOptions options={units.map((u) => ({ value: u.id, label: u.unit_number }))} />
          </Select>
        </Field>
      </div>
      {unitId && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COMPONENTS.map((c) => (
            <Field key={c} label={COMPONENT_LABEL[c]} htmlFor={`sim-ov-${c}`}>
              <Select value={overrides[c] ?? ""} onValueChange={(v) => setOverrides((o) => ({ ...o, [c]: v }))}>
                <SelectTrigger id={`sim-ov-${c}`} placeholder="unchanged" />
                <SelectOptions options={PROGRESS_STATES.map((s) => ({ value: s, label: s }))} />
              </Select>
            </Field>
          ))}
        </div>
      )}
      <Button size="sm" className="mt-3" onClick={simulate} disabled={!unitId || busy}>{busy ? "Simulating…" : "Simulate"}</Button>
      {simError && <p role="alert" className="mt-2 text-footnote text-overdue">{simError}</p>}
      {result && (
        <div className="mt-3 flex flex-wrap gap-2">
          {result.map((g) => (
            <div key={g.category_code} className="flex flex-col items-start gap-1">
              <span className="text-caption text-fg-subtle">{CATEGORY_LABEL[g.category_code] ?? g.category_code}</span>
              <GateChip state={g.state} note={g.reason_text} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
