import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { MessageSquare, Files, Activity as ActivityIcon, PanelRightClose, PanelRightOpen } from "lucide-react";

import CommentsTab from "./collab/CommentsTab";
import FilesTab from "./collab/FilesTab";
import ActivityTab from "./collab/ActivityTab";

const TABS = [
  { key: "comments", label: "Comments", icon: MessageSquare },
  { key: "files", label: "Files", icon: Files },
  { key: "activity", label: "Activity", icon: ActivityIcon },
];

// Amber "communication ribbon" surface — visually distinct from the main content.
const RIBBON_BG = "#FEF3C7";      // amber-100
const RIBBON_ACCENT = "#F59E0B";  // amber-500
const RIBBON_HEADING = "#78350F"; // amber-900
const RIBBON_TAB_ACTIVE = "#B45309"; // amber-700

// Reusable right-docked collaboration surface.
export default function CollaborationPanel({ entityType, entityId, entityTitle, inline = false }) {
  const [params, setParams] = useSearchParams();
  const initialTab = TABS.find((t) => t.key === params.get("collab"))?.key || "comments";
  const [tab, setTab] = useState(initialTab);
  const [collapsed, setCollapsed] = useState(false);
  const focusCommentId = params.get("comment");
  const navigate = useNavigate();

  useEffect(() => {
    if (inline) return; // inline mode: don't sync tab to URL (would clobber parent page tab)
    if (params.get("collab") !== tab) {
      const next = new URLSearchParams(params);
      if (tab === "comments") next.delete("collab"); else next.set("collab", tab);
      if (tab !== "comments") next.delete("comment");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!inline && collapsed) {
    return (
      <div className="hidden xl:flex flex-col items-center gap-2 pt-4 w-8" data-testid="collab-panel-collapsed">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="h-7 w-7 rounded-md border border-amber-300 flex items-center justify-center text-amber-800"
          style={{ background: RIBBON_BG }}
          title="Show collaboration panel"
          data-testid="collab-panel-expand"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <div
          className="rotate-180 [writing-mode:vertical-rl] text-[10px] uppercase tracking-widest mt-2"
          style={{ color: RIBBON_HEADING }}
        >
          Collaboration
        </div>
      </div>
    );
  }

  return (
    <aside
      className={inline ? "w-full" : "w-full xl:w-[420px] shrink-0 xl:sticky xl:top-20"}
      data-testid={`collab-panel-${entityType}`}
    >
      <div
        className={[
          "rounded-lg overflow-hidden flex flex-col relative",
          inline ? "" : "max-h-[calc(100vh-6rem)]",
          // Top-edge stripe when the panel stacks under content (mobile / narrow)
          "border-t-4 xl:border-t-0 xl:border-l-4",
        ].join(" ")}
        style={{
          background: RIBBON_BG,
          borderTopColor: RIBBON_ACCENT,
          borderLeftColor: RIBBON_ACCENT,
          boxShadow: "0 1px 3px rgba(146, 64, 14, 0.08)",
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200">
          <div className="min-w-0">
            <div
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: RIBBON_HEADING }}
            >
              Collaboration
            </div>
            <div
              className="text-xs font-medium truncate"
              style={{ color: "#0F172A" }}
              title={entityTitle}
            >
              {entityTitle}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="hidden xl:inline-flex h-6 w-6 items-center justify-center text-amber-800 hover:text-amber-900"
            title="Hide collaboration panel"
            data-testid="collab-panel-collapse"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-b border-amber-200 px-1" data-testid="collab-tabs">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs border-b-2 -mb-px font-medium",
                  active ? "font-semibold" : "text-amber-900/70 hover:text-amber-900",
                ].join(" ")}
                style={
                  active
                    ? { borderColor: RIBBON_TAB_ACTIVE, color: RIBBON_TAB_ACTIVE }
                    : { borderColor: "transparent" }
                }
                data-testid={`collab-tab-${t.key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto p-3 collab-panel-body">
          {!entityId ? (
            <div
              className="rounded-md border border-dashed border-amber-200 bg-white/60 p-6 text-center text-xs text-amber-900/70"
              data-testid="collab-no-selection"
            >
              Select an item to view its {tab === "files" ? "files" : tab === "activity" ? "activity" : "comments"}.
            </div>
          ) : (
            <>
              {tab === "comments" && <CommentsTab entityType={entityType} entityId={entityId} focusCommentId={focusCommentId} />}
              {tab === "files" && <FilesTab entityType={entityType} entityId={entityId} />}
              {tab === "activity" && <ActivityTab entityType={entityType} entityId={entityId} />}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
