import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Building2, LayoutGrid, Compass, Car, Ruler } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import PageHeader from "@/components/PageHeader";
import { formatINR } from "@/lib/format";

export default function UnitDetail() {
  const { id } = useParams();
  const [unit, setUnit] = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const u = await api.get(`/units/${id}`);
        if (!alive) return;
        setUnit(u.data);
        const p = await api.get(`/projects/${u.data.project_id}`);
        if (!alive) return;
        setProject(p.data);
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

  if (loading) return <div className="text-sm text-gray-500">Loading unit…</div>;
  if (!unit) return <div className="text-sm text-gray-500">Unit not found.</div>;

  return (
    <div className="flex flex-col xl:flex-row gap-6" data-testid="unit-detail-page">
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center gap-2 text-xs">
          <Link to="/admin/units" className="text-gray-500 hover:text-navy-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Units
          </Link>
        </div>

        <PageHeader
          title={<span className="flex items-center gap-3">Unit {unit.code} <StatusPill status={unit.status} /></span>}
          subtitle={project ? (
            <span className="text-xs">
              <Link to={`/projects/${project.id}`} className="text-navy-900 hover:underline">{project.name}</Link>
              {" · "}{project.type} · {project.location}
            </span>
          ) : ""}
          actions={<span className="font-heading text-lg font-semibold text-gray-900">{formatINR(unit.base_price_inr)}</span>}
        />

        <div className="rounded-md border border-gray-200 bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoCell icon={Building2} label="Tower · Floor · No." value={[unit.tower, unit.floor, unit.unit_no].filter(Boolean).join(" · ")} />
          <InfoCell icon={LayoutGrid} label="Type" value={unit.unit_type || "—"} />
          <InfoCell icon={Ruler} label="Carpet (sqft)" value={String(unit.carpet_area_sqft ?? "—")} />
          <InfoCell icon={Compass} label="Facing" value={unit.facing || "—"} />
          <InfoCell icon={Car} label="Parking" value={String(unit.parking_count ?? 0)} />
        </div>
      </div>

      <CollaborationPanel entityType="unit" entityId={id} entityTitle={`Unit ${unit.code}`} />
    </div>
  );
}

function InfoCell({ icon: Icon, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-600 font-semibold"><Icon className="h-3 w-3" /> {label}</div>
      <div className="text-sm text-gray-900 mt-0.5 truncate" title={value}>{value}</div>
    </div>
  );
}
