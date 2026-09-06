import { useEffect, useState } from "react";
import { Dialog, DialogContent, Field, Select, SelectTrigger, SelectOptions, Textarea, Button, Skeleton } from "@homeflow/ui";
import { journeyApi, type VersionData, type MigrationRule } from "./JourneyTemplateStudio";

interface Diff {
  addedStages: string[];
  removedStages: string[];
  changedStages: { code: string; changes: string[] }[];
}

function diffVersions(previous: VersionData, current: VersionData): Diff {
  const prevByCode = new Map(previous.stages.map((s) => [s.code, s]));
  const curByCode = new Map(current.stages.map((s) => [s.code, s]));
  const addedStages = current.stages.filter((s) => !prevByCode.has(s.code)).map((s) => s.code);
  const removedStages = previous.stages.filter((s) => !curByCode.has(s.code)).map((s) => s.code);
  const changedStages: Diff["changedStages"] = [];
  for (const [code, prev] of prevByCode) {
    const cur = curByCode.get(code);
    if (!cur) continue;
    const changes: string[] = [];
    if (prev.planned_duration_days !== cur.planned_duration_days) changes.push(`duration ${prev.planned_duration_days}d → ${cur.planned_duration_days}d`);
    if ((prev.customer_name ?? prev.name) !== (cur.customer_name ?? cur.name)) changes.push(`wording changed`);
    if ((prev.is_mandatory ?? true) !== (cur.is_mandatory ?? true)) changes.push(`mandatory: ${prev.is_mandatory} → ${cur.is_mandatory}`);
    const prevTasks = new Set(prev.tasks.map((t) => t.code));
    const curTasks = new Set(cur.tasks.map((t) => t.code));
    const addedTasks = cur.tasks.filter((t) => !prevTasks.has(t.code)).length;
    const removedTasks = prev.tasks.filter((t) => !curTasks.has(t.code)).length;
    if (addedTasks) changes.push(`+${addedTasks} task${addedTasks === 1 ? "" : "s"}`);
    if (removedTasks) changes.push(`-${removedTasks} task${removedTasks === 1 ? "" : "s"}`);
    if (changes.length) changedStages.push({ code, changes });
  }
  return { addedStages, removedStages, changedStages };
}

/** Publish dialog (05 Screens: "diff vs previous version and migration rule"). Rule 2: publishing
 * never alters existing journey_instance rows; OFFER_MIGRATION just raises an Action-review event
 * (10 doesn't exist yet to act on it) — the migration-rule choice only matters when a prior
 * PUBLISHED version exists, so it's hidden for a template's first publish. */
export function JourneyTemplatePublishDialog({
  templateId,
  version,
  onClose,
  onPublished,
}: {
  templateId: string;
  version: VersionData;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [previous, setPrevious] = useState<VersionData | null | undefined>(undefined);
  const [migrationRule, setMigrationRule] = useState<MigrationRule>("NEW_JOURNEYS_ONLY");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    journeyApi
      .listVersions(templateId)
      .then((versions) => {
        const prior = versions.find((v) => v.status === "PUBLISHED" && v.version < version.version);
        return prior ? journeyApi.getVersion(prior.id) : null;
      })
      .then(setPrevious)
      .catch(() => setPrevious(null));
  }, [templateId, version.version]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await journeyApi.publish(version.id, { migration_rule: previous ? migrationRule : undefined, change_note: changeNote.trim() || undefined });
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish this version.");
    } finally {
      setBusy(false);
    }
  }

  const diff = previous ? diffVersions(previous, version) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Publish v${version.version}`} description="Once published, this version is immutable — edit again only via a new draft.">
        <div className="flex flex-col gap-4">
          {previous === undefined && <Skeleton variant="text" />}

          {previous === null && <p className="text-footnote text-fg-subtle">This is the template's first published version — nothing to diff against.</p>}

          {diff && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-raised p-3 text-footnote">
              <p className="font-medium text-fg">Changes vs v{previous!.version} (published):</p>
              {diff.addedStages.length === 0 && diff.removedStages.length === 0 && diff.changedStages.length === 0 ? (
                <p className="text-fg-subtle">No stage/task-level changes detected.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {diff.addedStages.map((c) => (
                    <li key={`add-${c}`} className="text-ok">+ added stage {c}</li>
                  ))}
                  {diff.removedStages.map((c) => (
                    <li key={`rem-${c}`} className="text-danger">− removed stage {c}</li>
                  ))}
                  {diff.changedStages.map((s) => (
                    <li key={s.code}>
                      <span className="font-mono">{s.code}</span>: {s.changes.join(", ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {previous && (
            <Field label="Migration rule" htmlFor="pub-migration" required hint="p47 §34.7 t2 — existing journeys are never altered either way">
              <Select value={migrationRule} onValueChange={(v) => setMigrationRule(v as MigrationRule)}>
                <SelectTrigger id="pub-migration" />
                <SelectOptions
                  options={[
                    { value: "NEW_JOURNEYS_ONLY", label: "New journeys only" },
                    { value: "OFFER_MIGRATION", label: "Offer migration (raises a review Action)" },
                  ]}
                />
              </Select>
            </Field>
          )}

          <Field label="Change note" htmlFor="pub-note">
            <Textarea id="pub-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
          </Field>

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={submit}>
              Publish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
