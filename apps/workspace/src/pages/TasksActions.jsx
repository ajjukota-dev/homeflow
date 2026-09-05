import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Clock, UserRound } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import { EXECUTION_ICONS, PRIORITY_TONE, TASK_STATUS_TONE, displayTaskStatus } from "@/lib/journey";
import { useDepartmentColors } from "@/lib/stageColors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import TaskDetailModal from "@/components/journey/TaskDetailModal";
import { formatDate } from "@/lib/format";

const TABS = [
  { key: "mine", label: "My Tasks" },
  { key: "queue", label: "Department Queue" },
  { key: "overdue", label: "Overdue" },
  { key: "approvals", label: "Approvals" },
];

export default function TasksActions() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get("t") || "mine";
    return TABS.some((t) => t.key === q) ? q : "mine";
  }, [location.search]);

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTaskId, setOpenTaskId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (currentTab === "mine") params.mine = true;
      if (currentTab === "queue") {
        if (user?.department_id) params.department_id = user.department_id;
      }
      if (currentTab === "overdue") params.overdue = true;
      if (currentTab === "approvals") params.awaiting_approval_for_me = true;
      const r = await api.get(`/tasks`, { params });
      setTasks(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, user?.id]);

  const setTab = (v) => {
    if (v === currentTab) return;
    const next = new URLSearchParams(location.search);
    if (v === "mine") next.delete("t"); else next.set("t", v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="tasks-actions-page">
      <PageHeader
        title="Tasks & Actions"
        subtitle="Everything on your plate today — assigned to you, in your queue, overdue, or awaiting your approval."
      />

      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList data-testid="tasks-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`tasks-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <TaskTable tasks={tasks} loading={loading} tabKey={t.key} onOpen={(id) => setOpenTaskId(id)} />
          </TabsContent>
        ))}
      </Tabs>

      <TaskDetailModal
        taskId={openTaskId}
        open={Boolean(openTaskId)}
        onClose={() => setOpenTaskId(null)}
        onChanged={load}
      />
    </div>
  );
}

function TaskTable({ tasks, loading, tabKey, onOpen }) {
  const { colorFor } = useDepartmentColors();
  if (loading) return <div className="text-sm text-gray-500">Loading tasks…</div>;
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500" data-testid={`tasks-empty-${tabKey}`}>
        Nothing in this view.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid={`tasks-table-${tabKey}`}>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Task</Th>
            <Th>Customer</Th>
            <Th>Type</Th>
            <Th>Priority</Th>
            <Th>Due</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const Icon = EXECUTION_ICONS[t.execution_type] || EXECUTION_ICONS.Simple;
            const status = displayTaskStatus(t);
            const c = colorFor(t.department_id);
            return (
              <tr key={t.id} className="h-11 border-t border-gray-100" data-testid={`task-list-row-${t.id}`}>
                <td className="px-3 min-w-0 max-w-[300px]">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className="text-left w-full"
                    data-testid={`task-list-open-${t.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: c.dot }}
                        title={`Department stage colour`}
                      />
                      <Icon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                      <span className="text-sm text-gray-900 truncate">{t.title}</span>
                    </div>
                    {t.blocker_reason && (
                      <div className="text-[11px] text-red-700 truncate">⚠ {t.blocker_reason}</div>
                    )}
                  </button>
                </td>
                <td className="px-3">
                  {t._customer?.id ? (
                    <Link
                      to={`/customers/${t._customer.id}?tab=journey&task=${t.id}`}
                      className="text-navy-900 hover:underline text-xs"
                    >
                      <span className="font-mono text-gray-500 mr-1">{t._customer.code}</span>
                      {t._customer.primary_name}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </td>
                <td className="px-3 text-sm uppercase tracking-wide text-slate-600 font-semibold">{t.execution_type}</td>
                <td className="px-3"><StatusPill status={t.priority || "Medium"} tone={PRIORITY_TONE[t.priority] || "grey"} /></td>
                <td className="px-3 text-sm">
                  {t.due_date ? (
                    <span className={t.overdue ? "text-red-700 font-medium" : "text-gray-600"}>
                      <Clock className="inline h-3 w-3 mr-0.5" /> {formatDate(t.due_date)}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3"><StatusPill status={status} tone={TASK_STATUS_TONE[status]} /></td>
                <td className="px-3">
                  {!t.owner_user_id && (
                    <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                      <UserRound className="h-3 w-3" /> Unassigned
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">
      {children}
    </th>
  );
}
