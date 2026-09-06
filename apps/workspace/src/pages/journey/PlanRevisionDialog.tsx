import { useEffect, useState } from "react";
import { Dialog, DialogContent, Field, Input, Select, SelectTrigger, SelectOptions, Textarea, Button } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { journeyApi, type DelayReason } from "./api";

/** One dialog, two callers: JourneyTimeline (a single journeyId, "Revise plan" on one journey)
 *  and ProjectJourneyControl (multiple journeyIds, "shift N journeys with one reason" — 06's own
 *  Screens line for Project Journey Control). Applies the same stage/date/reason change to every
 *  journey in `journeyIds` via createPlanRevision, one call per journey (no bulk backend endpoint
 *  — each journey's own timeline_plan_revision row is the real unit of record either way). */
export function PlanRevisionDialog({
  journeyIds,
  stageOptions,
  onClose,
  onSaved,
}: {
  journeyIds: string[];
  stageOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stageCode, setStageCode] = useState(stageOptions[0]?.value ?? "");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<DelayReason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    journeyApi.listDelayReasons().then(setReasons).catch(() => setReasons([]));
  }, []);

  async function save() {
    setError(null);
    if (!stageCode.trim()) return setError("Choose a stage.");
    if (!newStart || !newEnd) return setError("New planned start and end are both required.");
    if (!reasonCode) return setError("A delay reason is mandatory when a planned date moves.");

    setBusy(true);
    try {
      const failures: string[] = [];
      for (const journeyId of journeyIds) {
        try {
          await journeyApi.createPlanRevision(journeyId, {
            changes: [{ stage_code: stageCode, new_planned_start: newStart, new_planned_end: newEnd }],
            reason_code: reasonCode,
            note: note.trim() || undefined,
          });
        } catch (e) {
          failures.push(e instanceof ApiError ? e.message : "failed");
        }
      }
      if (failures.length > 0) {
        setError(`${failures.length} of ${journeyIds.length} journeys couldn't be revised (e.g. "${failures[0]}"). The rest were.`);
      } else {
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  const multi = journeyIds.length > 1;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={multi ? `Revise plan — ${journeyIds.length} journeys` : "Revise plan"}
        description={multi ? "One stage, one reason, applied to every selected journey." : undefined}
      >
        <div className="flex flex-col gap-3">
          <Field label="Stage" htmlFor="pr-stage" required>
            {stageOptions.length > 0 ? (
              <Select value={stageCode} onValueChange={setStageCode}>
                <SelectTrigger id="pr-stage" />
                <SelectOptions options={stageOptions} />
              </Select>
            ) : (
              <Input id="pr-stage" value={stageCode} onChange={(e) => setStageCode(e.target.value)} placeholder="Stage code" />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New planned start" htmlFor="pr-start" required>
              <Input id="pr-start" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </Field>
            <Field label="New planned end" htmlFor="pr-end" required>
              <Input id="pr-end" type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Delay reason" htmlFor="pr-reason" required hint={reasons?.length === 0 ? "No delay reasons set up yet — add one in Policy Studio → Delay reasons first." : undefined}>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger id="pr-reason" />
              <SelectOptions options={(reasons ?? []).map((r) => ({ value: r.code, label: r.label }))} />
            </Select>
          </Field>
          <Field label="Note" htmlFor="pr-note" hint="Optional">
            <Textarea id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
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
            <Button onClick={save} disabled={busy || reasons === null}>
              {busy ? "Saving…" : "Save revision"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
