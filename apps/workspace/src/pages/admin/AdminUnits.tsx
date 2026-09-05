import { useEffect, useState } from "react";
import { api, type Project } from "../../api";
import type { AdminUnit } from "../../api-model";
import { MoneyFigure } from "../../ui/MoneyFigure";
import { BulkUnitForm } from "./BulkUnitForm";
import { saleStatusLabel } from "../../lib/labels";

// 04 §Screens "Units" — table per node, product-aware columns, bulk create from a range.

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";

function areaCell(u: AdminUnit): string {
  if (u.product_type === "PLOT") return u.plot_area_sqyd != null ? `${u.plot_area_sqyd} sqyd` : "—";
  return u.carpet_area_sqft != null ? `${u.carpet_area_sqft} sqft` : "—";
}

export function AdminUnits() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (ps[0]) setProjectId((cur) => cur || ps[0].id);
    });
  }, []);

  function reload() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    api
      .listProjectUnits(projectId)
      .then(setUnits)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [projectId]);

  return (
    <div>
      <h1 className="mb-4 text-large font-bold">Units</h1>

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

      <div className="mb-6">{projectId && <BulkUnitForm projectId={projectId} onCreated={reload} />}</div>

      {loading && <div className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" />}
      {!loading && units.length === 0 && (
        <p className="text-subhead text-fg-muted">No units yet — create some above.</p>
      )}
      {!loading && units.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-subhead">
            <thead className="bg-surface-2 text-footnote text-fg-muted">
              <tr>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Facing</th>
                <th className="px-3 py-2">Area</th>
                <th className="px-3 py-2">Base price</th>
                <th className="px-3 py-2">Sale status</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{u.unit_number}</td>
                  <td className="px-3 py-2 text-fg-muted">{u.code}</td>
                  <td className="px-3 py-2">{u.product_type}</td>
                  <td className="px-3 py-2">{u.unit_type}</td>
                  <td className="px-3 py-2">{u.facing}</td>
                  <td className="px-3 py-2">{areaCell(u)}</td>
                  <td className="px-3 py-2">
                    {u.base_price_inr != null ? <MoneyFigure amount={u.base_price_inr} /> : "—"}
                  </td>
                  <td className="px-3 py-2">{saleStatusLabel(u.sale_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
