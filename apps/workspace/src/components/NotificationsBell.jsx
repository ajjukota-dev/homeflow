import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck, MessageSquare, FileUp, ShieldCheck, Reply, AtSign } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { relTime } from "@/lib/relativeTime";
import { entityPath } from "@/lib/collab";
import { toast } from "sonner";

const POLL_MS = 45000;

const TYPE_ICON = {
  mention: AtSign,
  reply: Reply,
  file_uploaded: FileUp,
  verification_requested: ShieldCheck,
  verification_completed: ShieldCheck,
  comment_on_watched: MessageSquare,
};

export default function NotificationsBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setCount(data.count || 0);
    } catch {
      /* silent */
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications", { params: { limit: 10 } });
      setItems(data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchCount();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchCount]);

  useEffect(() => {
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchList();
  };

  const openItem = async (n) => {
    setOpen(false);
    // mark read
    try {
      if (!n.read_at) await api.post(`/notifications/${n.id}/read`);
    } catch {
      /* silent */
    }
    fetchCount();
    // navigate
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

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all", {});
      toast.success("All notifications marked read");
      fetchCount();
      fetchList();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const badge = count > 9 ? "9+" : count > 0 ? String(count) : null;

  return (
    <div ref={rootRef} className="relative" data-testid="notifications-bell">
      <button
        type="button"
        onClick={toggle}
        className="relative h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
        data-testid="notifications-bell-button"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {badge && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center"
            data-testid="notifications-badge"
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[380px] rounded-md border border-gray-200 bg-white shadow-lg" data-testid="notifications-dropdown">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <div className="text-sm font-medium text-gray-900">Notifications</div>
            <button
              type="button"
              onClick={markAll}
              className="text-xs text-navy-900 hover:underline flex items-center gap-1"
              data-testid="notifications-mark-all"
            >
              <CheckCheck className="h-3 w-3" /> Mark all read
            </button>
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            {loading && <div className="p-4 text-xs text-gray-500">Loading…</div>}
            {!loading && items.length === 0 && <div className="p-6 text-center text-xs text-gray-500">You're all caught up.</div>}
            {!loading && items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {items.map((n) => {
                  const Icon = TYPE_ICON[n.type] || MessageSquare;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={[
                          "w-full flex items-start gap-2 px-3 py-2 hover:bg-brand-50/40 text-left",
                          n.read_at ? "" : "bg-brand-50/20",
                        ].join(" ")}
                        data-testid={`notification-item-${n.id}`}
                      >
                        <span className="mt-0.5 h-6 w-6 rounded-full bg-brand-50 text-navy-900 flex items-center justify-center shrink-0">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-medium text-gray-900 truncate">{n.title}</div>
                            {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-red-600 shrink-0" aria-hidden />}
                          </div>
                          {n.body && <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{n.body}</div>}
                          <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide">{n.type.replace(/_/g, " ")} · {relTime(n.created_at)}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/notifications");
              }}
              className="text-xs text-navy-900 hover:underline flex items-center gap-1"
              data-testid="notifications-view-all"
            >
              <Check className="h-3 w-3" /> View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
