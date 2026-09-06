import { useState } from "react";
import { Drawer, DrawerContent, Field, Input, Select, SelectTrigger, SelectOptions, Textarea, Checkbox, Button } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { studioApi, type StudioRow } from "./api";

// 06-timeline-sla-engine.md's Data row only lists TASK_CODE/ACTION_TYPE/STAGE_CODE — the other
// three were added to the real CHECK constraint by later specs' migrations (0032 QA severity,
// 0044 communications, 0045 post-handover) and are real seeded rows today (snag_critical,
// customer_query_response, warranty_minor). All six, not just 06's original three, or this Select
// silently shows blank for 3 of the 26 seeded policies (found live, not guessed).
const APPLIES_TO = [
  { value: "TASK_CODE", label: "Task code" },
  { value: "ACTION_TYPE", label: "Action type" },
  { value: "STAGE_CODE", label: "Stage code" },
  { value: "SNAG_SEVERITY", label: "Snag severity (15)" },
  { value: "CUSTOMER_QUERY", label: "Customer query (29)" },
  { value: "WARRANTY_SEVERITY", label: "Warranty severity (30)" },
];
const DURATION_UNIT = [
  { value: "WORKING_DAYS", label: "Working days" },
  { value: "CALENDAR_DAYS", label: "Calendar days" },
  { value: "HOURS", label: "Hours" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add/edit one sla_policy row, then a real preview-before-publish step (this file's whole
 *  reason to exist over RowEditor's blind text-field form): draft, ask the backend how many
 *  currently open sla_clock rows this change touches, show that count, only then publish — the
 *  "bespoke" half of studio/core.ts's sla_policy design (draft/publish storage itself is the same
 *  generic envelope every other registered table uses). */
export function SlaPolicyDrawer({
  policy,
  delayReasonCodes,
  onClose,
  onSaved,
}: {
  policy: StudioRow | null; // null = new policy
  delayReasonCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = policy === null;
  const [id, setId] = useState(isNew ? "" : (policy!.id as string));
  const [code, setCode] = useState((policy?.code as string) ?? "");
  const [appliesTo, setAppliesTo] = useState((policy?.applies_to as string) ?? "TASK_CODE");
  const [targetRef, setTargetRef] = useState((policy?.target_ref as string) ?? "");
  const [durationValue, setDurationValue] = useState(String(policy?.duration_value ?? 3));
  const [durationUnit, setDurationUnit] = useState((policy?.duration_unit as string) ?? "WORKING_DAYS");
  const [dueSoonLead, setDueSoonLead] = useState(String(policy?.due_soon_lead_days ?? 2));
  const [atRiskRule, setAtRiskRule] = useState((policy?.at_risk_rule as string) ?? "");
  const [pauseReasons, setPauseReasons] = useState<Set<string>>(new Set((policy?.pause_reasons as string[]) ?? []));
  const [escalationLadderId, setEscalationLadderId] = useState((policy?.escalation_ladder_id as string) ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState((policy?.effective_from as string)?.slice(0, 10) ?? todayIso());
  const [effectiveTo, setEffectiveTo] = useState((policy?.effective_to as string)?.slice(0, 10) ?? "");
  // The policy_version publish stamp (when this edit takes effect system-wide) — kept distinct
  // from effective_from above, which is sla_policy's own business column (same "Publish date" vs
  // business effective_from split RowEditor.tsx already draws for risk_rule/probability_rule).
  const [publishDate, setPublishDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Two-phase, same shape as JourneyTemplatePublishDialog: stage a draft, look at real impact,
  // only then confirm. A brand-new policy has no clocks yet — 0 is a true answer, not a guess.
  const [pending, setPending] = useState<{ draftId: string; rowId: string; openClocks: number } | null>(null);

  function togglePauseReason(reasonCode: string) {
    setPauseReasons((prev) => {
      const next = new Set(prev);
      if (next.has(reasonCode)) next.delete(reasonCode);
      else next.add(reasonCode);
      return next;
    });
  }

  async function stageDraft() {
    setError(null);
    const rowId = isNew ? id.trim() : (policy!.id as string);
    if (!rowId) return setError("Policy id is required.");
    if (!code.trim() || !targetRef.trim()) return setError("Code and target ref are required.");
    const durationNum = Number(durationValue);
    if (!Number.isFinite(durationNum) || durationNum <= 0) return setError("Duration must be a positive number.");
    const dueSoonNum = Number(dueSoonLead);
    if (!Number.isFinite(dueSoonNum) || dueSoonNum < 0) return setError("Due-soon lead must be a non-negative number.");

    const values: StudioRow = {
      code: code.trim(),
      applies_to: appliesTo,
      target_ref: targetRef.trim(),
      duration_value: durationNum,
      duration_unit: durationUnit,
      due_soon_lead_days: dueSoonNum,
      at_risk_rule: atRiskRule.trim() || null,
      pause_reasons: Array.from(pauseReasons),
      escalation_ladder_id: escalationLadderId.trim() || null,
      effective_from: effectiveFrom,
      effective_to: effectiveTo || null,
    };
    if (isNew) values.id = rowId;

    setBusy(true);
    try {
      const draft = await studioApi.draftRow("sla_policy", isNew ? null : rowId, values, note || undefined);
      const preview = await studioApi.previewChange("sla_policy", rowId);
      setPending({ draftId: draft.id, rowId, openClocks: preview.open_sla_clocks });
    } catch (e) {
      if (e instanceof ApiError) setError(e.code === "forbidden" ? "You don't have edit access for this tab." : e.message);
      else setError("Couldn't stage this change.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await studioApi.publishRow("sla_policy", pending.draftId, publishDate, note || undefined);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Couldn't publish this change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={isNew ? "New SLA policy" : `Edit SLA policy — ${policy!.code}`} width={640}>
        <div className="flex flex-col gap-4 p-6">
          {pending ? (
            <div className="flex flex-col gap-4">
              <div
                role="status"
                className="rounded-card border border-line bg-surface-raised p-3 text-ws-sm text-fg"
              >
                {pending.openClocks > 0
                  ? `This change affects ${pending.openClocks} currently open SLA clock${pending.openClocks === 1 ? "" : "s"}. Due-soon lead time, pause reasons and the escalation ladder apply to those immediately on publish; the duration only applies to clocks started after this.`
                  : "No open SLA clocks currently reference this policy — publishing changes nothing in flight."}
              </div>
              <Field label="Publish date" htmlFor="sp-publish-date" hint="When this change takes effect" required>
                <Input id="sp-publish-date" type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="text-footnote text-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                  Back
                </Button>
                <Button onClick={confirmPublish} disabled={busy}>
                  {busy ? "Publishing…" : "Confirm & publish"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {isNew && (
                <Field label="Policy id" htmlFor="sp-id" required>
                  <Input id="sp-id" value={id} onChange={(e) => setId(e.target.value)} />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" htmlFor="sp-code" required>
                  <Input id="sp-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={!isNew} />
                </Field>
                <Field label="Applies to" htmlFor="sp-applies" required>
                  <Select value={appliesTo} onValueChange={setAppliesTo}>
                    <SelectTrigger id="sp-applies" />
                    <SelectOptions options={APPLIES_TO} />
                  </Select>
                </Field>
              </div>
              <Field label="Target ref" htmlFor="sp-target" required hint="Task/action/stage code this policy governs">
                <Input id="sp-target" value={targetRef} onChange={(e) => setTargetRef(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Duration" htmlFor="sp-duration" required>
                  <Input id="sp-duration" type="number" min={1} value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
                </Field>
                <Field label="Duration unit" htmlFor="sp-unit" required>
                  <Select value={durationUnit} onValueChange={setDurationUnit}>
                    <SelectTrigger id="sp-unit" />
                    <SelectOptions options={DURATION_UNIT} />
                  </Select>
                </Field>
              </div>
              <Field label="Due-soon lead (days)" htmlFor="sp-due-soon" required>
                <Input id="sp-due-soon" type="number" min={0} value={dueSoonLead} onChange={(e) => setDueSoonLead(e.target.value)} />
              </Field>
              <Field label="At-risk rule" htmlFor="sp-at-risk" hint="Optional — e.g. blocked, or forecast > planned">
                <Textarea id="sp-at-risk" rows={2} value={atRiskRule} onChange={(e) => setAtRiskRule(e.target.value)} />
              </Field>
              {delayReasonCodes.length > 0 && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-ws-sm font-medium text-fg">Pause reasons</legend>
                  <div className="grid grid-cols-2 gap-1.5">
                    {delayReasonCodes.map((rc) => (
                      <label key={rc} className="flex items-center gap-2 text-footnote">
                        <Checkbox checked={pauseReasons.has(rc)} onCheckedChange={() => togglePauseReason(rc)} aria-label={`Pause for ${rc}`} />
                        {rc}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <Field label="Escalation ladder id" htmlFor="sp-ladder" hint="Optional — 12's ladders have no picker here yet, enter the id directly">
                <Input id="sp-ladder" value={escalationLadderId} onChange={(e) => setEscalationLadderId(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Effective from" htmlFor="sp-eff-from" required>
                  <Input id="sp-eff-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <Field label="Effective to" htmlFor="sp-eff-to" hint="Optional">
                  <Input id="sp-eff-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
                </Field>
              </div>
              <Field label="Change note" htmlFor="sp-note" hint="Why this change — kept in the history log">
                <Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="text-footnote text-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={stageDraft} disabled={busy}>
                  {busy ? "Checking impact…" : "Continue"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
