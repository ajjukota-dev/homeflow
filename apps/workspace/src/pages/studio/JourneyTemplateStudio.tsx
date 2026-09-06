import { useEffect, useState } from "react";
import { PageHeader, Skeleton, EmptyState, Badge, Select, SelectTrigger, SelectOptions, Button, Dialog, DialogContent, Field, Input } from "@homeflow/ui";
import { Route } from "lucide-react";
import { ApiError } from "../../auth/api";
import { JourneyTemplateVersionEditor } from "./JourneyTemplateVersionEditor";

// 05-journey-templates.md Screens: "Journey Template Studio: template list; version editor with
// stage lanes (streams as swimlanes), task cards, dependency lines, conditional badges,
// customer-wording column, visibility per role; publish dialog with diff vs previous version and
// migration rule; preview for a sample customer." The tab registry (studio/registry.ts) has
// carried `05.journey_template_studio` as `built: true` since R2 — this file is what makes that
// true; before this slice, Shell.tsx's "has its own dedicated screen elsewhere" fallback message
// was describing a screen that didn't exist (found in review, not by a user).
export type Stream = "COMMERCIAL" | "LEGAL" | "FINANCE" | "CONSTRUCTION" | "HANDOVER" | "POST_HANDOVER";
export type TaskType = "MANDATORY" | "CONDITIONAL";
export type ExecutionType = "SIMPLE" | "VERIFICATION" | "EVIDENCE" | "APPROVAL" | "CHECKLIST" | "EXTERNAL";
export type ExternalParty = "CUSTOMER" | "SRO" | "BANK" | "VENDOR";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DependencyKind = "FINISH_TO_START" | "START_TO_START";
export type MigrationRule = "NEW_JOURNEYS_ONLY" | "OFFER_MIGRATION";
export type VersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export const STREAMS: { value: Stream; label: string }[] = [
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "LEGAL", label: "Legal" },
  { value: "FINANCE", label: "Finance" },
  { value: "CONSTRUCTION", label: "Construction" },
  { value: "HANDOVER", label: "Handover" },
  { value: "POST_HANDOVER", label: "Post-Handover" },
];

export interface TaskDef {
  code: string;
  title: string;
  customer_title?: string | null;
  owner_role: string;
  task_type: TaskType;
  execution_type: ExecutionType;
  verifier_role?: string | null;
  approver_role?: string | null;
  external_party?: ExternalParty | null;
  required_document_category?: string | null;
  checklist_items?: string[];
  priority?: Priority;
  sla_policy_id?: string | null;
  condition_expr?: string | null;
  customer_visible?: boolean;
  sort_order?: number;
}

export interface StageDef {
  code: string;
  name: string;
  customer_name?: string | null;
  sort_order?: number;
  stream: Stream;
  customer_visible?: boolean;
  planned_duration_days: number;
  owner_department: string;
  entry_gate_expr?: string | null;
  is_mandatory?: boolean;
  condition_expr?: string | null;
  tasks: TaskDef[];
  visibility?: { role_code: string; visible: boolean }[];
}

export interface DependencyDef {
  from_task_code: string;
  to_task_code: string;
  kind: DependencyKind;
  lag_days?: number;
}

export interface VersionContent {
  stages: StageDef[];
  dependencies: DependencyDef[];
}

export interface VersionData extends VersionContent {
  id: string;
  template_id: string;
  version: number;
  status: VersionStatus;
  change_note: string | null;
}

export interface VersionSummary {
  id: string;
  version: number;
  status: VersionStatus;
  published_at: string | null;
  change_note: string | null;
}

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  scope: "STANDARD" | "PROJECT";
  project_id: string | null;
  product_type: string | null;
  latest_version: number | null;
  latest_status: VersionStatus | null;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}
function get<T>(url: string): Promise<T> {
  return fetch(url).then((r) => unwrap<T>(r));
}
function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => unwrap<T>(r));
}

export const journeyApi = {
  listTemplates: () => get<TemplateRow[]>("/api/journey-templates"),
  createTemplate: (input: { code: string; name: string; scope: "STANDARD" | "PROJECT"; project_id?: string; parent_template_id?: string; product_type?: string }) =>
    send<{ id: string }>("POST", "/api/journey-templates", input),
  listVersions: (templateId: string) => get<VersionSummary[]>(`/api/journey-templates/${templateId}/versions`),
  createVersion: (templateId: string) => send<{ id: string }>("POST", `/api/journey-templates/${templateId}/versions`),
  getVersion: (versionId: string) => get<VersionData>(`/api/journey-template-versions/${versionId}`),
  putContent: (versionId: string, content: VersionContent) => send<{ ok: boolean }>("PUT", `/api/journey-template-versions/${versionId}/content`, content),
  publish: (versionId: string, input: { migration_rule?: MigrationRule; change_note?: string }) =>
    send<{ id: string; status: string }>("POST", `/api/journey-template-versions/${versionId}/publish`, input),
  preview: (versionId: string, productType?: string, residency?: string) => {
    const qs = new URLSearchParams();
    if (productType) qs.set("product_type", productType);
    if (residency) qs.set("residency", residency);
    return get<{ stage_code: string; task_codes: string[] }[]>(`/api/journey-template-versions/${versionId}/preview?${qs}`);
  },
};

function NewTemplateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"STANDARD" | "PROJECT">("STANDARD");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (scope === "PROJECT" && !projectId.trim()) {
      setError("project_id is required for a Project-scope template.");
      return;
    }
    setBusy(true);
    try {
      const { id } = await journeyApi.createTemplate({ code: code.trim(), name: name.trim(), scope, project_id: scope === "PROJECT" ? projectId.trim() : undefined });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New journey template" description="A Standard template applies to every project; a Project template overrides one project's journey.">
        <div className="flex flex-col gap-3">
          <Field label="Code" htmlFor="jt-code" required hint="Stable identifier, e.g. PRANAVA_STANDARD_V2">
            <Input id="jt-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name" htmlFor="jt-name" required>
            <Input id="jt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Scope" htmlFor="jt-scope" required>
            <Select value={scope} onValueChange={(v) => setScope(v as "STANDARD" | "PROJECT")}>
              <SelectTrigger id="jt-scope" />
              <SelectOptions options={[{ value: "STANDARD", label: "Standard (all projects)" }, { value: "PROJECT", label: "Project override" }]} />
            </Select>
          </Field>
          {scope === "PROJECT" && (
            <Field label="Project id" htmlFor="jt-project" required hint="e.g. p_eastcrest">
              <Input id="jt-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !code.trim() || !name.trim()}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JourneyTemplateStudio({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [showNewTemplate, setShowNewTemplate] = useState(false);

  function loadTemplates(selectAfter?: string) {
    setError(false);
    journeyApi
      .listTemplates()
      .then((rows) => {
        setTemplates(rows);
        setTemplateId((cur) => selectAfter ?? cur ?? rows[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (!templateId) {
      setVersions(null);
      return;
    }
    setVersions(null);
    setVersionId(null);
    journeyApi
      .listVersions(templateId)
      .then((v) => {
        setVersions(v);
        setVersionId(v[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }, [templateId]);

  const selectedTemplate = templates?.find((t) => t.id === templateId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Journey Template Studio"
        description="Pranava Standard Journey Template → Project overrides → Journey Instance per booking (p44–47 §34)."
        actions={canEdit ? <Button onClick={() => setShowNewTemplate(true)}>New template</Button> : undefined}
      />

      {error && <EmptyState icon={Route} message="Couldn't load journey templates." action={{ label: "Retry", onClick: () => loadTemplates() }} />}

      {!error && templates === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}

      {!error && templates && templates.length === 0 && (
        <EmptyState icon={Route} message="No journey templates yet." action={canEdit ? { label: "Create the first one", onClick: () => setShowNewTemplate(true) } : undefined} />
      )}

      {!error && templates && templates.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Template" htmlFor="jt-template-select" className="w-72">
            <Select value={templateId ?? undefined} onValueChange={setTemplateId}>
              <SelectTrigger id="jt-template-select" placeholder="Choose a template" />
              <SelectOptions
                options={templates.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.scope}${t.product_type ? `, ${t.product_type}` : ""})`,
                }))}
              />
            </Select>
          </Field>
          {selectedTemplate?.scope === "PROJECT" && <Badge>Project: {selectedTemplate.project_id}</Badge>}

          {versions && versions.length > 0 && (
            <Field label="Version" htmlFor="jt-version-select" className="w-56">
              <Select value={versionId ?? undefined} onValueChange={setVersionId}>
                <SelectTrigger id="jt-version-select" />
                <SelectOptions options={versions.map((v) => ({ value: v.id, label: `v${v.version} — ${v.status}` }))} />
              </Select>
            </Field>
          )}
        </div>
      )}

      {templateId && versions === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}

      {templateId && versions && versions.length === 0 && (
        <EmptyState
          icon={Route}
          message="This template has no versions yet."
          action={canEdit ? { label: "Create the first version", onClick: () => journeyApi.createVersion(templateId).then(() => journeyApi.listVersions(templateId)).then((v) => { setVersions(v); setVersionId(v[0]?.id ?? null); }) } : undefined}
        />
      )}

      {versionId && (
        <JourneyTemplateVersionEditor
          key={versionId}
          templateId={templateId!}
          versionId={versionId}
          canEdit={canEdit}
          onVersionsChanged={(selectId) => journeyApi.listVersions(templateId!).then((v) => { setVersions(v); setVersionId((cur) => selectId ?? v.find((x) => x.id === cur)?.id ?? v[0]?.id ?? null); })}
        />
      )}

      {showNewTemplate && (
        <NewTemplateDialog
          onClose={() => setShowNewTemplate(false)}
          onCreated={(id) => {
            setShowNewTemplate(false);
            loadTemplates(id);
          }}
        />
      )}
    </div>
  );
}
