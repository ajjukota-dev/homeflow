import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Skeleton, EmptyState, Badge } from "@homeflow/ui";
import { Settings2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { studioApi, type TabDef } from "./api";
import { GENERIC_TABLES, TAB_TO_TABLE } from "./registry";
import { GenericTableEditor } from "./GenericTableEditor";
import { JourneyTemplateStudio } from "./JourneyTemplateStudio";
import { SlaPolicyStudio } from "./SlaPolicyStudio";

// Tabs with their own bespoke screen (not the generic /studio/:table envelope) — same "flag,
// don't fake" spirit as GENERIC_TABLES, but for tabs whose edit surface isn't a plain table.
const BESPOKE_TABS: Record<string, (canEdit: boolean) => ReactNode> = {
  "05.journey_template_studio": (canEdit) => <JourneyTemplateStudio canEdit={canEdit} />,
  "06.sla_policies": (canEdit) => <SlaPolicyStudio canEdit={canEdit} />,
};

/** Policy Studio shell (25-policy-studio.md Screens): left nav grouped by owning spec, one
 *  content pane. A tab either resolves to a generic-envelope table (GENERIC_TABLES) and gets the
 *  real editor, or it doesn't yet — shown honestly as "not built", the same flag-don't-fake
 *  pattern the tab registry itself already uses (`built: false`). */
export function Studio() {
  const [tabs, setTabs] = useState<TabDef[] | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    studioApi
      .listTabs()
      .then((t) => {
        setTabs(t);
        setActive((cur) => cur ?? t[0]?.key ?? null);
      })
      .catch(() => setError(true));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<number, TabDef[]>();
    for (const t of tabs ?? []) {
      if (!map.has(t.owner_spec)) map.set(t.owner_spec, []);
      map.get(t.owner_spec)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [tabs]);

  const activeTab = tabs?.find((t) => t.key === active) ?? null;
  const tableName = activeTab ? TAB_TO_TABLE[activeTab.key] ?? null : null;
  const tableDef = tableName ? GENERIC_TABLES[tableName] : null;

  // lg, not md: the app's own sidebar already claims 16rem at md, so Studio's own nav+content
  // split only kicks in once there's room for three columns (measured cramped at 768 in review).
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="w-full shrink-0 lg:w-64" aria-label="Policy Studio tabs">
        <div className="mb-3 flex items-center gap-2 px-1">
          <Settings2 className="h-5 w-5 text-fg-muted" />
          {/* h2, not h1: GenericTableEditor's PageHeader renders the page's one real h1 (CLAUDE.md
              "one h1 per page") — this nav title sits alongside it, not in place of it. */}
          <h2 className="text-title2 font-bold tracking-tight">Policy Studio</h2>
        </div>
        {error && <p className="px-1 text-footnote text-overdue">Couldn't load Studio tabs.</p>}
        {!error && tabs === null && (
          <div className="flex flex-col gap-2 px-1">
            <Skeleton variant="text" />
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        )}
        {groups.map(([spec, group]) => (
          <div key={spec} className="mb-3">
            <div className="px-2 pb-1 text-caption font-semibold uppercase tracking-wide text-fg-subtle">Spec {spec}</div>
            <div className="flex flex-col gap-0.5">
              {group.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  aria-current={active === t.key ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-subhead font-medium transition-colors",
                    active === t.key ? "bg-surface-2 text-accent" : "text-fg-muted hover:bg-surface-2"
                  )}
                >
                  <span className="truncate">{t.label}</span>
                  {!t.built && (
                    <Badge tone="neutral" className="shrink-0">
                      not built
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {activeTab && BESPOKE_TABS[activeTab.key] ? (
          BESPOKE_TABS[activeTab.key](activeTab.can_edit)
        ) : activeTab && tableDef ? (
          // key={tableName} forces a full remount so old rows never render against the new table's def.
          <GenericTableEditor key={tableName} table={tableName!} label={activeTab.label} def={tableDef} canEdit={activeTab.can_edit} />
        ) : activeTab ? (
          <EmptyState
            icon={Settings2}
            message={
              activeTab.built
                ? `${activeTab.label} is built on the backend, but this Studio tab's editor UI isn't built here yet — flagged in TODO.md.`
                : `${activeTab.label} has no edit path yet — flagged in TODO.md, not built.`
            }
          />
        ) : null}
      </div>
    </div>
  );
}
