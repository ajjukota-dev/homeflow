import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CheckCheck, AtSign, Reply, FileUp, ShieldCheck, MessageSquare } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { entityPath } from "@/lib/collab";
import { relTime } from "@/lib/relativeTime";
import { formatDateTime } from "@/lib/format";

const TYPE_META = {
  mention: { icon: AtSign, label: "Mention" },
  reply: { icon: Reply, label: "Reply" },
  file_uploaded: { icon: FileUp, label: "File uploaded" },
  verification_requested: { icon: ShieldCheck, label: "Verification requested" },
  verification_completed: { icon: ShieldCheck, label: "Verification completed" },
  comment_on_watched: { icon: MessageSquare, label: "Watched thread" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mentions", label: "Mentions" },
  { key: "files", label: "Files" },
];

export default function NotificationsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications", { params: { limit: 100 } });
      setRows(data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all", {});
      toast.success("All marked read");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const openItem = async (n) => {
    try {
      if (!n.read_at) await api.post(`/notifications/${n.id}/read`);
    } catch {
      /* silent */
    }
    const target = entityPath(n.entity_type, n.entity_id);
    const params = new URLSearchParams();
    if (n.comment_id) {
      params.set("tab", "comments");
      params.set("comment", n.comment_id);
    } else if (n.attachment_id) {
      params.set("tab", "files");
    }
    navigate(`${target}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const filtered = rows.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read_at;
    if (filter === "mentions") return n.type === "mention";
    if (filter === "files") return n.type.startsWith("file_") || n.type.startsWith("verification");
    return true;
  });

  return (
    <div className="space-y-6" data-testid="notifications-page">
      <PageHeader
        title="Notifications"
        subtitle="Mentions, replies, file uploads and verification updates."
        actions={
          <Button variant="secondary" onClick={markAll} className="h-9" data-testid="notifications-page-mark-all">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={[
              "text-xs px-3 py-1.5 rounded-full border",
              filter === f.key ? "bg-navy-900 text-white border-navy-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
            ].join(" ")}
            data-testid={`notifications-filter-${f.key}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
        {loading ? (
          <div className="p-6 text-sm text-gray-500 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Nothing here.</div>
        ) : (
          filtered.map((n) => {
            const meta = TYPE_META[n.type] || TYPE_META.comment_on_watched;
            const Icon = meta.icon;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={[
                  "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-brand-50/30",
                  n.read_at ? "" : "bg-brand-50/10",
                ].join(" ")}
                data-testid={`notifications-page-item-${n.id}`}
              >
                <span className="mt-0.5 h-7 w-7 rounded-full bg-brand-50 text-navy-900 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{meta.label}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-[11px] text-gray-500" title={formatDateTime(n.created_at)}>{relTime(n.created_at)}</span>
                    {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-red-600" />}
                  </div>
                  <div className="text-sm text-gray-900 mt-0.5">{n.title}</div>
                  {n.body && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</div>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
