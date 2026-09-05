import { useEffect, useState } from "react";
import { api, type Project } from "../../api";
import type { ProjectMaster, ProductType, ProjectStatus } from "../../api-model";
import { Card, CardBody } from "@homeflow/ui";
import { HierarchyEditor } from "./HierarchyEditor";
import type { HierarchyNode } from "../../api-model";

// 04 §Screens "Projects" — master fields + hierarchy tree editor.

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";
const PRODUCT_TYPES: ProductType[] = ["APARTMENT", "VILLA", "PLOT", "MIXED"];
const STATUSES: ProjectStatus[] = ["PLANNING", "ACTIVE", "HANDOVER", "CLOSED"];

export function AdminProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [master, setMaster] = useState<ProjectMaster | null>(null);
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (ps[0]) setProjectId((cur) => cur || ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    Promise.all([api.getProjectMaster(projectId), api.listHierarchy(projectId)])
      .then(([m, h]) => {
        setMaster(m);
        setNodes(h);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function saveMaster(patch: Partial<ProjectMaster>) {
    if (!master) return;
    setSaving(true);
    try {
      setMaster(await api.updateProject(master.id, patch));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-large font-bold">Projects</h1>

      <select
        className={inputCls + " mb-6 max-w-xs"}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Select project"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.code})
          </option>
        ))}
      </select>

      {error && <p className="mb-4 text-subhead text-overdue">{error}</p>}
      {loading && <div className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" />}

      {!loading && master && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardBody>
              <h2 className="mb-3 text-title3 font-semibold">Master fields</h2>
              <div className="flex flex-col gap-3">
                <label className="text-footnote text-fg-muted">
                  Product type
                  <select
                    className={inputCls}
                    value={master.product_type}
                    onChange={(e) => saveMaster({ product_type: e.target.value as ProductType })}
                  >
                    {PRODUCT_TYPES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-footnote text-fg-muted">
                  Status
                  <select
                    className={inputCls}
                    value={master.status}
                    onChange={(e) => saveMaster({ status: e.target.value as ProjectStatus })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-footnote text-fg-muted">
                  Legal entity
                  <input
                    className={inputCls}
                    defaultValue={master.legal_entity ?? ""}
                    onBlur={(e) => saveMaster({ legal_entity: e.target.value })}
                  />
                </label>
                <label className="text-footnote text-fg-muted">
                  RERA registration no.
                  <input
                    className={inputCls}
                    defaultValue={master.rera_reg_no ?? ""}
                    onBlur={(e) => saveMaster({ rera_reg_no: e.target.value })}
                  />
                </label>
                {saving && <p className="text-footnote text-fg-muted">Saving…</p>}
              </div>
            </CardBody>
          </Card>

          <HierarchyEditor projectId={projectId} nodes={nodes} onChange={setNodes} />
        </div>
      )}
    </div>
  );
}
