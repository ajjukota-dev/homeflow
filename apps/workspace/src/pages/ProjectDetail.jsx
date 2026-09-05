import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { formatINR } from "@/lib/format";

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [p, u] = await Promise.all([
          api.get(`/projects/${id}`),
          api.get(`/units`, { params: { project_id: id } }),
        ]);
        if (!alive) return;
        setProject(p.data);
        setUnits(u.data || []);
      } catch (e) {
        apiErrorToast(e);
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <div className="text-sm text-gray-500">Loading project…</div>;
  if (!project) return <div className="text-sm text-gray-500">Project not found.</div>;

  const bucket = (s) => units.filter((u) => u.status === s).length;

  return (
    <div className="space-y-6" data-testid="project-detail-page">
      <div className="flex items-center gap-2 text-xs">
        <Link to="/admin/projects" className="text-gray-500 hover:text-navy-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Projects
        </Link>
      </div>
      <PageHeader
        title={<span className="flex items-center gap-3">{project.name} <StatusPill status={project.status} /></span>}
        subtitle={<span className="font-mono text-xs">{project.code} · {project.type} · {project.location}</span>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Available" value={bucket("Available")} tone="grey" />
        <Stat label="Booked" value={bucket("Booked")} tone="blue" />
        <Stat label="Registered" value={bucket("Registered")} tone="purple" />
        <Stat label="Handed Over" value={bucket("Handed Over")} tone="green" />
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</th>
              <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Type</th>
              <th className="h-9 px-3 text-right text-xs uppercase tracking-wide text-slate-600 font-semibold">Carpet</th>
              <th className="h-9 px-3 text-right text-xs uppercase tracking-wide text-slate-600 font-semibold">Base price</th>
              <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="h-10 border-t border-gray-100">
                <td className="px-3 font-mono text-xs">
                  <Link to={`/units/${u.id}`} className="text-navy-900 hover:underline">{u.code}</Link>
                </td>
                <td className="px-3 text-sm text-gray-700">{u.unit_type || "—"}</td>
                <td className="px-3 text-right text-sm tabular-nums">{u.carpet_area_sqft}</td>
                <td className="px-3 text-right text-sm tabular-nums">{formatINR(u.base_price_inr)}</td>
                <td className="px-3"><StatusPill status={u.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <StatusPill status={label} tone={tone} />
      <div className="font-heading text-2xl font-semibold text-gray-900 mt-2">{value}</div>
    </div>
  );
}
