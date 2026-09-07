import { useEffect, useState } from "react";
import { Button, PageHeader, Skeleton, EmptyState, Field, Input, Select, SelectTrigger, SelectOptions } from "@homeflow/ui";
import { FileStack, Trash2, CheckCircle2, PencilLine, Archive } from "lucide-react";
import { api, type Project } from "../../api";
import { specificationApi, type Baseline, type SpecItems } from "../specification/api";

// 09-specification-revisions.md Screens: "Policy Studio → Specification baselines". Own bespoke
// screen (not the generic /studio/:table envelope) — `items` is a category-keyed jsonb object,
// not a flat row shape. Project-scoped (specification_baseline.project_id is NOT NULL, unlike
// 18's cr_approval_rule which defaults to a standard/null scope) — a project picker is required.
const PRODUCT_TYPES: Baseline["product_type"][] = ["APARTMENT", "VILLA", "PLOT", "MIXED"];

type ItemDraft = { category: string; spec: string; brand_model: string; qty: string };

function draftToItems(draft: ItemDraft[]): SpecItems {
  const out: SpecItems = {};
  for (const d of draft) {
    if (!d.category.trim() || !d.spec.trim()) continue;
    out[d.category.trim()] = { spec: d.spec.trim(), brand_model: d.brand_model.trim() || null, qty: d.qty.trim() ? Number(d.qty) : null };
  }
  return out;
}

export function SpecificationBaselinesStudio({ canEdit }: { canEdit: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [baselines, setBaselines] = useState<Baseline[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<{ product_type: Baseline["product_type"]; unit_type: string; name: string; items: ItemDraft[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then((p) => {
      setProjects(p);
      setProjectId((cur) => cur || p[0]?.id || "");
    });
  }, []);

  function load(pid: string) {
    if (!pid) return;
    setError(false);
    specificationApi.listBaselines(pid).then(setBaselines).catch(() => setError(true));
  }
  useEffect(() => { if (projectId) load(projectId); }, [projectId]);

  function blankDraft() {
    setDraft({ product_type: "VILLA", unit_type: "", name: "", items: [{ category: "", spec: "", brand_model: "", qty: "" }] });
  }

  async function createDraft() {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await specificationApi.createBaseline({ project_id: projectId, product_type: draft.product_type, unit_type: draft.unit_type.trim() || null, name: draft.name.trim(), items: draftToItems(draft.items) });
      setDraft(null);
      load(projectId);
    } catch {
      setSaveError("Couldn't create the baseline.");
    } finally {
      setSaving(false);
    }
  }

  async function approve(id: string) {
    setSaving(true);
    setSaveError(null);
    try {
      await specificationApi.approveBaseline(id);
      load(projectId);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't approve the baseline.");
    } finally {
      setSaving(false);
    }
  }

  // Icon + label, never colour alone (CLAUDE.md's UI bar) — a local chip since Badge (packages/ui)
  // carries no status-tone variant and StatusChip's CONFIG map doesn't cover baseline statuses.
  const STATUS_META: Record<Baseline["status"], { icon: typeof CheckCircle2; label: string; className: string }> = {
    APPROVED: { icon: CheckCircle2, label: "Approved", className: "bg-ok-soft text-ok-fg" },
    DRAFT: { icon: PencilLine, label: "Draft", className: "bg-warn-soft text-warn-fg" },
    RETIRED: { icon: Archive, label: "Retired", className: "bg-surface-raised text-fg-muted" },
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Specification baselines"
        description="09-specification-revisions.md rule 1 — the approved baseline every unit's specification attaches to at booking confirmation. One APPROVED row per project/product/unit type; approving retires the previous version."
        actions={canEdit && projectId ? <Button onClick={blankDraft}>+ New baseline</Button> : undefined}
      />

      <Field label="Project" htmlFor="sb-project">
        <Select value={projectId} onValueChange={setProjectId} disabled={!projects}>
          <SelectTrigger id="sb-project" />
          <SelectOptions options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        </Select>
      </Field>

      {error && <EmptyState icon={FileStack} message="Couldn't load specification baselines." action={{ label: "Retry", onClick: () => load(projectId) }} />}
      {!error && baselines === null && (
        <div className="flex flex-col gap-2"><Skeleton /><Skeleton /></div>
      )}
      {!error && baselines !== null && baselines.length === 0 && !draft && (
        <EmptyState icon={FileStack} message="No specification baselines for this project yet — units can't attach a specification until one is APPROVED." action={canEdit ? { label: "Create the first baseline", onClick: blankDraft } : undefined} />
      )}

      {!error && baselines !== null && baselines.length > 0 && (
        <div className="flex flex-col gap-3">
          {baselines.map((b) => (
            <div key={b.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-body">{b.name}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-medium ${STATUS_META[b.status].className}`}>
                  {(() => { const Icon = STATUS_META[b.status].icon; return <Icon className="size-3.5" aria-hidden />; })()}
                  {STATUS_META[b.status].label}
                </span>
                <span className="text-footnote text-fg-muted">v{b.version} · {b.product_type}{b.unit_type ? ` / ${b.unit_type}` : ""}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-footnote text-fg-muted">
                {Object.entries(b.items).map(([cat, item]) => (
                  <li key={cat}><span className="font-medium text-fg">{cat}</span>: {item.spec}{item.brand_model ? ` — ${item.brand_model}` : ""}{item.qty != null ? ` (qty ${item.qty})` : ""}</li>
                ))}
              </ul>
              {canEdit && b.status === "DRAFT" && (
                <Button size="sm" className="mt-2" onClick={() => approve(b.id)} disabled={saving}>Approve</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <h3 className="text-subhead font-semibold">New baseline (draft)</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Product type" htmlFor="sb-product-type">
              <Select value={draft.product_type} onValueChange={(v) => setDraft({ ...draft, product_type: v as Baseline["product_type"] })}>
                <SelectTrigger id="sb-product-type" />
                <SelectOptions options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))} />
              </Select>
            </Field>
            <Field label="Unit type (optional)" htmlFor="sb-unit-type">
              <Input id="sb-unit-type" value={draft.unit_type} onChange={(e) => setDraft({ ...draft, unit_type: e.target.value })} placeholder="e.g. 3BHK" />
            </Field>
            <Field label="Name" htmlFor="sb-name">
              <Input id="sb-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="text-footnote font-medium text-fg-muted">Items (category → spec)</div>
            {draft.items.map((it, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_1.5fr_5rem_auto]">
                <Input value={it.category} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x)) })} placeholder="category (e.g. flooring)" />
                <Input value={it.spec} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, idx) => (idx === i ? { ...x, spec: e.target.value } : x)) })} placeholder="spec text" />
                <Input value={it.brand_model} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, idx) => (idx === i ? { ...x, brand_model: e.target.value } : x)) })} placeholder="brand/model" />
                <Input value={it.qty} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)) })} placeholder="qty" type="number" />
                <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, idx) => idx !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setDraft({ ...draft, items: [...draft.items, { category: "", spec: "", brand_model: "", qty: "" }] })}>+ Add item</Button>
          </div>
          {saveError && <p role="alert" className="mt-2 text-footnote text-overdue">{saveError}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={createDraft} disabled={saving || !draft.name.trim()}>{saving ? "Creating…" : "Create draft"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
