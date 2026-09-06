import { useEffect, useState } from "react";
import { Drawer, DrawerContent, Skeleton, EmptyState, Badge } from "@homeflow/ui";
import { History } from "lucide-react";
import { studioApi, type HistoryRow } from "./api";

/** Rule 1's "history with who/when/why" — read-only, per row. */
export function HistoryDrawer({ table, rowId, onClose }: { table: string; rowId: string; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    studioApi
      .getHistory(table, rowId)
      .then((r) => setRows(r.slice().reverse()))
      .catch(() => setError(true));
  }, [table, rowId]);

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={`History — ${rowId}`} width={480}>
        {error && <p className="text-ws-sm text-danger">Couldn't load history for this row.</p>}
        {!error && rows === null && (
          <div className="flex flex-col gap-3">
            <Skeleton variant="text" />
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        )}
        {rows && rows.length === 0 && <EmptyState icon={History} message="No changes recorded for this row yet." />}
        {rows && rows.length > 0 && (
          <ol className="flex flex-col gap-4">
            {rows.map((h) => (
              <li key={h.id} className="rounded-card border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ws-sm font-semibold text-fg">v{h.version}</span>
                  <Badge tone={h.effective_from ? "accent" : "neutral"}>{h.effective_from ? `effective ${h.effective_from.slice(0, 10)}` : "draft"}</Badge>
                </div>
                <div className="mt-1 text-ws-xs text-fg-muted">
                  {new Date(h.changed_at).toLocaleString()} · {h.changed_by}
                </div>
                {h.change_note && <div className="mt-1 text-ws-sm text-fg">{h.change_note}</div>}
                <pre className="mt-2 overflow-x-auto rounded-control bg-surface-raised p-2 text-ws-xs text-fg-muted">
                  {JSON.stringify(h.diff, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </DrawerContent>
    </Drawer>
  );
}
