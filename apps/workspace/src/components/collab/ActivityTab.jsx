import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, Pencil, PlusCircle, Trash2, MessageSquare, Paperclip, ShieldCheck } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { canReadAudit } from "@/lib/collab";
import { useAuth } from "@/lib/auth";
import { relTime } from "@/lib/relativeTime";
import { formatDateTime } from "@/lib/format";

const ACTION_ICON = {
  create: PlusCircle,
  update: Pencil,
  delete: Trash2,
};

const ENTITY_ICON = {
  comment: MessageSquare,
  attachment: Paperclip,
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "changes", label: "Changes" },
  { key: "comments", label: "Comments" },
  { key: "files", label: "Files" },
];

export default function ActivityTab({ entityType, entityId }) {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const authorised = canReadAudit(user);

  useEffect(() => {
    if (!authorised) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // Single query — server merges direct rows + child rows via parent_entity_*
        const { data } = await api.get("/audit_logs", {
          params: { entity_type: entityType, entity_id: entityId, limit: 200 },
        });
        if (!alive) return;
        setLogs(data || []);
      } catch (e) {
        // Non-privileged users get 403 — treat as an empty activity view rather than surfacing a toast.
        if (e?.response?.status !== 403) {
          apiErrorToast(e);
        }
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entityType, entityId, authorised]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      const et = l.entity_type;
      if (filter === "all") return true;
      if (filter === "changes") return et === entityType;
      if (filter === "comments") return et === "comment";
      if (filter === "files") return et === "attachment";
      return true;
    });
  }, [logs, filter, entityType]);

  if (!authorised) {
    return (
      <div className="py-8 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-md" data-testid="activity-restricted">
        Activity feed is available to Super Admin and Management only.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="activity-tab">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={[
              "text-[11px] px-2 py-1 rounded-full border",
              filter === f.key ? "bg-navy-900 text-white border-navy-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
            ].join(" ")}
            data-testid={`activity-filter-${f.key}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-xs text-gray-500 py-4 text-center">Loading activity…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-md">
          No activity in this filter.
        </div>
      ) : (
        <ol className="relative border-l border-gray-200 ml-2 space-y-2">
          {filtered.map((l) => {
            const ActionIcon = ACTION_ICON[l.action] || Activity;
            const EntityIcon = ENTITY_ICON[l.entity_type] || null;
            return (
              <li key={l.id} className="ml-4" data-testid={`activity-item-${l.id}`}>
                <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-navy-900" />
                <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-gray-800">
                    <ActionIcon className="h-3.5 w-3.5 text-gray-500" />
                    <span className="font-medium">{l.actor_name || "Unknown"}</span>
                    <span className="text-gray-500">{l.action}d</span>
                    {EntityIcon && <EntityIcon className="h-3 w-3 text-gray-400" />}
                    <span className="text-gray-700">{l.entity_type}</span>
                  </div>
                  {l.after?.filename && (
                    <div className="mt-0.5 text-[11px] text-gray-500 truncate">{l.after.filename} · {l.after.category} · v{l.after.version}</div>
                  )}
                  {l.after?.body && l.entity_type === "comment" && (
                    <div className="mt-0.5 text-[11px] text-gray-500 line-clamp-2">"{l.after.body}"</div>
                  )}
                  {l.after?.verification_status && l.entity_type === "attachment" && l.action === "update" && (
                    <div className="mt-0.5 text-[11px] text-gray-500 flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {l.after.verification_status}</div>
                  )}
                  {l.entity_type === "booking" && l.after?.status && l.before?.status && l.after.status !== l.before.status && (
                    <div className="mt-0.5 text-[11px] text-gray-500">status {l.before.status} → {l.after.status}</div>
                  )}
                  <div className="mt-1 text-[10px] text-gray-400 uppercase tracking-wide" title={formatDateTime(l.timestamp)}>
                    {relTime(l.timestamp)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
