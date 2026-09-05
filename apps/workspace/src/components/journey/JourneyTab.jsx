import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/context/PermissionsContext";
import ProgressRail from "./ProgressRail";
import NextBestActions from "./NextBestActions";
import StageAccordion from "./StageAccordion";
import TaskDetailModal from "./TaskDetailModal";
import { Button } from "@/components/ui/button";

/** Case-insensitive substring match of a stage's code OR name against the
 *  role's visibility list. Empty list → hide everything. Null → show all. */
function stageIsVisible(stage, visibility) {
  if (visibility == null) return true;
  const hay = `${stage?.code || ""} ${stage?.name || ""}`.toLowerCase();
  return visibility.some((needle) => hay.includes(String(needle).toLowerCase()));
}

export default function JourneyTab({ customerId }) {
  const { user } = useAuth();
  const { perms } = usePermissions();
  const [journey, setJourney] = useState(null);
  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [params, setParams] = useSearchParams();
  const openTaskId = params.get("task");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get(`/journeys`, { params: { customer_id: customerId } });
      setJourneys(list.data || []);
      const primary = (list.data || [])[0];
      if (!primary) {
        setJourney(null);
        return;
      }
      const full = await api.get(`/journeys/${primary.id}`);
      setJourney(full.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const onOpenTask = (taskId) => {
    const next = new URLSearchParams(params);
    next.set("task", taskId);
    setParams(next, { replace: true });
  };
  const onCloseTask = () => {
    const next = new URLSearchParams(params);
    next.delete("task");
    setParams(next, { replace: true });
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
  };

  if (loading) return <div className="text-sm text-gray-500">Loading journey…</div>;
  if (!journey) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center" data-testid="journey-empty">
        <div className="text-sm text-gray-700">No journey yet.</div>
        <div className="text-xs text-gray-500 mt-1">A journey is instantiated automatically when a booking is confirmed.</div>
      </div>
    );
  }

  // Apply per-role journey stage visibility (BANKING sees only Home Loan /
  // Payments stages; other roles see everything). Super admin passes through
  // because permissions endpoint returns null visibility for them.
  const visibility = perms?.journeyStageVisibility ?? null;
  const filteredJourney =
    visibility == null
      ? journey
      : { ...journey, stages: (journey.stages || []).filter((s) => stageIsVisible(s, visibility)) };

  return (
    <div className="space-y-4" data-testid="journey-tab">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">
          Journey id: <span className="font-mono">{journey.id.slice(0, 8)}…</span>
          {" · "}Template v{journey.workflow_template_version}
          {" · "}Status: <span className="font-medium text-gray-900">{journey.status}</span>
          {journeys.length > 1 && (
            <span className="ml-2 text-amber-700">({journeys.length} journeys for this customer)</span>
          )}
          {visibility != null && (
            <span className="ml-2 text-slate-500" data-testid="journey-visibility-note">
              (showing {filteredJourney.stages.length} of {(journey.stages || []).length} stages scoped to your role)
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing} data-testid="journey-refresh">
          <RefreshCw className={["h-3.5 w-3.5", refreshing ? "animate-spin" : ""].join(" ")} /> Refresh
        </Button>
      </div>

      <ProgressRail journey={filteredJourney} />
      <NextBestActions journey={filteredJourney} currentUserId={user?.id} onOpenTask={onOpenTask} />
      <StageAccordion journey={filteredJourney} onOpenTask={onOpenTask} />

      <TaskDetailModal
        taskId={openTaskId}
        open={Boolean(openTaskId)}
        onClose={onCloseTask}
        onChanged={load}
      />
    </div>
  );
}
