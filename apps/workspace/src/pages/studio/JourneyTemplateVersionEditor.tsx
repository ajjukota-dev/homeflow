import { useEffect, useState } from "react";
import { Skeleton, EmptyState, Badge, Button } from "@homeflow/ui";
import { Route, Plus, Eye } from "lucide-react";
import { journeyApi, STREAMS, type VersionData, type StageDef, type DependencyDef } from "./JourneyTemplateStudio";
import { JourneyTemplateStageCard } from "./JourneyTemplateStageCard";
import { JourneyTemplateStageDrawer } from "./JourneyTemplateStageDrawer";
import { JourneyTemplateTaskDrawer } from "./JourneyTemplateTaskDrawer";
import { JourneyTemplateDependencies } from "./JourneyTemplateDependencies";
import { JourneyTemplatePublishDialog } from "./JourneyTemplatePublishDialog";
import { JourneyTemplatePreviewDialog } from "./JourneyTemplatePreviewDialog";

// Dependency "lines" (spec Screens: "dependency lines") render as a plain list here, not SVG
// connectors between task cards — the swimlane grid already groups by stream (rows) x sort_order
// (columns) with no fixed pixel geometry, so a real connector line has nothing stable to anchor
// to without a canvas layout this slice didn't build. The list carries the identical information
// (which task gates which, FS/SS, lag) — flagged as a visual simplification, not a missing fact.
export function JourneyTemplateVersionEditor({
  templateId,
  versionId,
  canEdit,
  onVersionsChanged,
}: {
  templateId: string;
  versionId: string;
  canEdit: boolean;
  // Passing a versionId selects it directly (New draft: the parent's own "keep the current
  // selection if it still exists" default would otherwise re-select the just-published version
  // instead of the new draft — found live-clicking through this, not in a mocked test).
  onVersionsChanged: (selectVersionId?: string) => void;
}) {
  const [version, setVersion] = useState<VersionData | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [editingStage, setEditingStage] = useState<StageDef | "new" | null>(null);
  const [editingTask, setEditingTask] = useState<{ stageCode: string; task: import("./JourneyTemplateStudio").TaskDef | "new" } | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(false);
    journeyApi.getVersion(versionId).then(setVersion).catch(() => setError(true));
  }
  useEffect(load, [versionId]);

  const editable = canEdit && version?.status === "DRAFT";
  const allTaskCodes = (version?.stages ?? []).flatMap((s) => s.tasks.map((t) => t.code));

  async function saveContent(stages: StageDef[], dependencies: DependencyDef[]) {
    setBusy(true);
    setNotice(null);
    try {
      await journeyApi.putContent(versionId, { stages, dependencies });
      load();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Couldn't save the change." });
    } finally {
      setBusy(false);
    }
  }

  async function handleNewDraft() {
    setBusy(true);
    try {
      const { id } = await journeyApi.createVersion(templateId);
      onVersionsChanged(id);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Couldn't create a new draft." });
    } finally {
      setBusy(false);
    }
  }

  function removeDependency(dep: DependencyDef) {
    if (!version) return;
    saveContent(
      version.stages,
      version.dependencies.filter((d) => !(d.from_task_code === dep.from_task_code && d.to_task_code === dep.to_task_code))
    );
  }

  if (error) return <EmptyState icon={Route} message="Couldn't load this version." action={{ label: "Retry", onClick: load }} />;
  if (version === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  const streamGroups = STREAMS.map((s) => ({
    ...s,
    stages: version.stages.filter((st) => st.stream === s.value).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  })).filter((g) => g.stages.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-3">
        <div className="flex items-center gap-2">
          <Badge>v{version.version}</Badge>
          <Badge tone={version.status === "PUBLISHED" ? "accent" : "neutral"}>{version.status}</Badge>
          {version.change_note && <span className="text-footnote text-fg-muted">{version.change_note}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowPreview(true)}>
            <Eye className="mr-1 size-4" aria-hidden /> Preview
          </Button>
          {editable && (
            <Button size="sm" onClick={() => setShowPublish(true)}>
              Publish
            </Button>
          )}
          {canEdit && version.status !== "DRAFT" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={handleNewDraft}>
              New draft from this version
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-footnote text-danger" : "text-footnote text-ok"}>
          {notice.text}
        </p>
      )}

      {!editable && canEdit && (
        <p className="text-footnote text-fg-subtle">Only a DRAFT version can be edited — start a new draft to make changes.</p>
      )}

      {streamGroups.length === 0 && (
        <EmptyState icon={Route} message="This version has no stages yet." action={editable ? { label: "Add the first stage", onClick: () => setEditingStage("new") } : undefined} />
      )}

      {streamGroups.map((group) => (
        <section key={group.value} className="flex flex-col gap-2">
          <h3 className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">{group.label}</h3>
          <div className="flex flex-wrap gap-3">
            {group.stages.map((stage) => (
              <JourneyTemplateStageCard
                key={stage.code}
                stage={stage}
                canEdit={editable}
                onEditStage={() => setEditingStage(stage)}
                onAddTask={() => setEditingTask({ stageCode: stage.code, task: "new" })}
                onEditTask={(task) => setEditingTask({ stageCode: stage.code, task })}
              />
            ))}
          </div>
        </section>
      ))}

      {editable && (
        <Button size="sm" variant="secondary" className="w-fit" onClick={() => setEditingStage("new")}>
          <Plus className="mr-1 size-4" aria-hidden /> Add stage
        </Button>
      )}

      <JourneyTemplateDependencies
        dependencies={version.dependencies}
        taskCodes={allTaskCodes}
        editable={editable}
        onAdd={(dep) => saveContent(version.stages, [...version.dependencies, dep])}
        onRemove={removeDependency}
      />

      {editingStage !== null && (
        <JourneyTemplateStageDrawer
          stage={editingStage === "new" ? null : editingStage}
          existingCodes={version.stages.map((s) => s.code)}
          onClose={() => setEditingStage(null)}
          onSave={(stage) => {
            const next = editingStage === "new" ? [...version.stages, stage] : version.stages.map((s) => (s.code === (editingStage as StageDef).code ? { ...stage, tasks: s.tasks } : s));
            saveContent(next, version.dependencies);
            setEditingStage(null);
          }}
          onRemove={
            editingStage !== "new"
              ? () => {
                  const removedCodes = new Set((editingStage as StageDef).tasks.map((t) => t.code));
                  saveContent(
                    version.stages.filter((s) => s.code !== (editingStage as StageDef).code),
                    version.dependencies.filter((d) => !removedCodes.has(d.from_task_code) && !removedCodes.has(d.to_task_code))
                  );
                  setEditingStage(null);
                }
              : undefined
          }
        />
      )}

      {editingTask !== null && (
        <JourneyTemplateTaskDrawer
          task={editingTask.task === "new" ? null : editingTask.task}
          existingCodes={version.stages.find((s) => s.code === editingTask.stageCode)?.tasks.map((t) => t.code) ?? []}
          onClose={() => setEditingTask(null)}
          onSave={(task) => {
            const next = version.stages.map((s) => {
              if (s.code !== editingTask.stageCode) return s;
              const tasks = editingTask.task === "new" ? [...s.tasks, task] : s.tasks.map((t) => (t.code === (editingTask.task as import("./JourneyTemplateStudio").TaskDef).code ? task : t));
              return { ...s, tasks };
            });
            saveContent(next, version.dependencies);
            setEditingTask(null);
          }}
          onRemove={
            editingTask.task !== "new"
              ? () => {
                  const removedCode = (editingTask.task as import("./JourneyTemplateStudio").TaskDef).code;
                  const next = version.stages.map((s) => (s.code === editingTask.stageCode ? { ...s, tasks: s.tasks.filter((t) => t.code !== removedCode) } : s));
                  saveContent(next, version.dependencies.filter((d) => d.from_task_code !== removedCode && d.to_task_code !== removedCode));
                  setEditingTask(null);
                }
              : undefined
          }
        />
      )}

      {showPublish && (
        <JourneyTemplatePublishDialog
          templateId={templateId}
          version={version}
          onClose={() => setShowPublish(false)}
          onPublished={() => {
            setShowPublish(false);
            // versionId is unchanged by a publish (same version, new status) — the parent's
            // <JourneyTemplateVersionEditor key={versionId}> only remounts (and reloads) on an
            // id change, so this component must refetch its own status/content itself, not rely
            // on the remount that "New draft" gets for free (live-clicked through publish before
            // this fix: dropdown showed PUBLISHED, but this panel kept showing DRAFT + edit
            // controls until a manual reload).
            load();
            onVersionsChanged();
          }}
        />
      )}

      {showPreview && <JourneyTemplatePreviewDialog versionId={versionId} onClose={() => setShowPreview(false)} />}
    </div>
  );
}
