import { useEffect, useState } from "react";
import { Drawer, DrawerContent, Field, Input, Select, SelectTrigger, SelectOptions, Button, IconButton } from "@homeflow/ui";
import { Plus, Trash2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { api, type Project } from "../../api";
import { paymentPlanApi, type PaymentPlan, type PaymentPlanMilestone } from "./api";

const STANDARD_TEMPLATE_VALUE = "";

function emptyMilestone(sequence: number): PaymentPlanMilestone {
  return { milestone_key: "", milestone_label: "", construction_trigger_event: null, sequence, pct_of_consideration: 0 };
}

/** Add/edit one payment_plan row plus its ordered payment_plan_milestone children
 *  (19-collections-true-risk.md Screens: "Studio: Payment plans"). Plain CRUD — the whole
 *  milestone list is replaced on save (payment-plans.ts), so there's no per-row draft state to
 *  track here, unlike SlaPolicyDrawer's two-phase publish. */
export function PaymentPlanDrawer({ plan, onClose, onSaved }: { plan: PaymentPlan | null; onClose: () => void; onSaved: () => void }) {
  const isNew = plan === null;
  const [name, setName] = useState(plan?.name ?? "");
  const [basis, setBasis] = useState(plan?.basis ?? "construction_linked");
  const [projectId, setProjectId] = useState(plan?.project_id ?? STANDARD_TEMPLATE_VALUE);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<PaymentPlanMilestone[]>(plan?.milestones.length ? [...plan.milestones] : [emptyMilestone(1)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const projectOptions = [
    { value: STANDARD_TEMPLATE_VALUE, label: "Standard template (seeds new projects; not usable for demand generation)" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const totalPct = milestones.reduce((sum, m) => sum + (Number(m.pct_of_consideration) || 0), 0);

  function updateMilestone(index: number, patch: Partial<PaymentPlanMilestone>) {
    setMilestones((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function addMilestone() {
    setMilestones((prev) => [...prev, emptyMilestone(prev.length + 1)]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    if (!name.trim() || !basis.trim()) return setError("Name and basis are required.");
    if (milestones.length === 0) return setError("At least one milestone is required.");
    for (const m of milestones) {
      if (!m.milestone_key.trim() || !m.milestone_label.trim()) return setError("Every milestone needs a key and a label.");
      if (!Number.isInteger(Number(m.sequence)) || Number(m.sequence) < 1) return setError("Every milestone's sequence must be a positive whole number.");
      if (!Number.isFinite(Number(m.pct_of_consideration)) || Number(m.pct_of_consideration) <= 0) {
        return setError("Every milestone's % of consideration must be a positive number.");
      }
    }
    const keys = milestones.map((m) => m.milestone_key.trim());
    if (new Set(keys).size !== keys.length) return setError("Milestone keys must be unique within a plan.");
    const sequences = milestones.map((m) => Number(m.sequence));
    if (new Set(sequences).size !== sequences.length) return setError("Milestone sequence numbers must be unique within a plan.");

    const payload = milestones.map((m) => ({
      milestone_key: m.milestone_key.trim(),
      milestone_label: m.milestone_label.trim(),
      construction_trigger_event: m.construction_trigger_event?.trim() || null,
      sequence: Number(m.sequence),
      pct_of_consideration: Number(m.pct_of_consideration),
    }));

    setBusy(true);
    try {
      const project_id = projectId === STANDARD_TEMPLATE_VALUE ? null : projectId;
      if (isNew) {
        await paymentPlanApi.create({ project_id, name: name.trim(), basis: basis.trim(), milestones: payload });
      } else {
        await paymentPlanApi.update(plan!.id, { project_id, name: name.trim(), basis: basis.trim(), milestones: payload });
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setError(e.code === "forbidden" ? "You don't have edit access for this tab." : e.message);
      else setError("Couldn't save this payment plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={isNew ? "New payment plan" : `Edit payment plan — ${plan!.name}`} width={640}>
        <div className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="pp-name" required>
              <Input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Basis" htmlFor="pp-basis" required hint="e.g. construction_linked">
              <Input id="pp-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
            </Field>
            <Field label="Project" htmlFor="pp-project" hint="Which project's demands this plan can be picked for">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="pp-project" />
                <SelectOptions options={projectOptions} />
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-ws-sm font-medium text-fg">Milestones</span>
              <span className={`text-footnote ${Math.abs(totalPct - 100) < 1e-9 ? "text-fg-muted" : "text-overdue"}`}>
                Total: {totalPct}% of consideration{Math.abs(totalPct - 100) >= 1e-9 ? " — doesn't add up to 100%" : ""}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {milestones.map((m, i) => (
                <fieldset key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                  <legend className="sr-only">Milestone {i + 1}</legend>
                  <div className="flex items-start gap-2">
                    <div className="grid grow grid-cols-[3.5rem_1fr] gap-2">
                      <Field label="Seq" htmlFor={`pp-seq-${i}`}>
                        <Input
                          id={`pp-seq-${i}`}
                          type="number"
                          min={1}
                          value={m.sequence}
                          onChange={(e) => updateMilestone(i, { sequence: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Label" htmlFor={`pp-label-${i}`}>
                        <Input id={`pp-label-${i}`} value={m.milestone_label} onChange={(e) => updateMilestone(i, { milestone_label: e.target.value })} />
                      </Field>
                    </div>
                    <IconButton
                      icon={Trash2}
                      aria-label={`Remove milestone ${i + 1}`}
                      onClick={() => removeMilestone(i)}
                      disabled={milestones.length <= 1}
                      className="mt-6"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Key" htmlFor={`pp-key-${i}`}>
                      <Input id={`pp-key-${i}`} value={m.milestone_key} onChange={(e) => updateMilestone(i, { milestone_key: e.target.value })} />
                    </Field>
                    <Field label="Trigger event" htmlFor={`pp-trigger-${i}`} hint="Optional">
                      <Input
                        id={`pp-trigger-${i}`}
                        value={m.construction_trigger_event ?? ""}
                        onChange={(e) => updateMilestone(i, { construction_trigger_event: e.target.value })}
                      />
                    </Field>
                    <Field label="% of total" htmlFor={`pp-pct-${i}`}>
                      <Input
                        id={`pp-pct-${i}`}
                        type="number"
                        min={0}
                        max={100}
                        value={m.pct_of_consideration}
                        onChange={(e) => updateMilestone(i, { pct_of_consideration: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </fieldset>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={addMilestone} className="self-start">
              <Plus className="h-4 w-4" /> Add milestone
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
