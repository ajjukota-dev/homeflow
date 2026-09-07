// 28-360-views.md — generic tab content. Rule "Not in this feature: content of tabs is owned by
// their specs" means this never re-implements another module's UI; it fetches that module's own
// endpoint (`entry.api`) and renders a read-only summary, generically, from whatever shape comes
// back (array of rows -> table; object -> key/value + first nested list, if any). A handful of
// tabs that already have a purpose-built embeddable component (Commitments, Journey, Handover,
// Registration, Sales-handover) use that component directly instead — see Unit360/Booking360.
import { useEffect, useState } from "react";
import { FileQuestion, CircleAlert } from "lucide-react";
import { EmptyState, Skeleton, KeyValue, Badge } from "@homeflow/ui";
import type { TabManifestEntry } from "./api";
import { threeSixtyApi } from "./api";
import { prettifyKey, formatCell, pickColumns } from "./format";

function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <EmptyState icon={FileQuestion} message="Nothing here yet." />;
  const cols = pickColumns(rows);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-footnote">
        <thead className="bg-surface-2">
          <tr className="text-caption uppercase tracking-wide text-fg-subtle">
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap p-2 text-left">{prettifyKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={String(r.id ?? i)} className="border-t border-line">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap p-2">{formatCell(c, r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <p className="p-2 text-caption text-fg-subtle">Showing the first 50 of {rows.length} — open the full module for more.</p>}
    </div>
  );
}

function GenericObject({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  const listEntry = entries.find(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object");
  const scalarItems = entries
    .filter(([k, v]) => !Array.isArray(v) && typeof v !== "object" && !/^id$|_id$/i.test(k))
    .slice(0, 10)
    .map(([k, v]) => ({ key: prettifyKey(k), value: formatCell(k, v) }));
  return (
    <div className="flex flex-col gap-4">
      {scalarItems.length > 0 && <KeyValue items={scalarItems} />}
      {listEntry && <GenericTable rows={listEntry[1] as Record<string, unknown>[]} />}
      {scalarItems.length === 0 && !listEntry && <EmptyState icon={FileQuestion} message="Nothing here yet." />}
    </div>
  );
}

/** Fetches `entry.api` lazily (on first activation) and renders it generically. */
export function TabPanel({ entry }: { entry: TabManifestEntry }) {
  const [data, setData] = useState<unknown>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!entry.available || !entry.api) return;
    setData(undefined);
    setError(false);
    threeSixtyApi.fetchTabData(entry.api).then(setData).catch(() => setError(true));
  }, [entry.available, entry.api]);

  if (!entry.available) {
    return <EmptyState icon={FileQuestion} message={entry.unavailable_reason ?? "Not yet available."} />;
  }
  if (error) return <EmptyState icon={CircleAlert} message="Couldn't load this tab." />;
  if (data === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (Array.isArray(data)) {
    return <GenericTable rows={data as Record<string, unknown>[]} />;
  }
  if (data && typeof data === "object") {
    return <GenericObject data={data as Record<string, unknown>} />;
  }
  return <EmptyState icon={FileQuestion} message="Nothing here yet." />;
}

export function TabBadge({ entry }: { entry: TabManifestEntry }) {
  if (entry.available) return null;
  return <Badge className="ml-1.5">soon</Badge>;
}
