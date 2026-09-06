import { useEffect, useState } from "react";
import { Button, Skeleton, EmptyState, PageHeader } from "@homeflow/ui";
import { Table2, History } from "lucide-react";
import { studioApi, type StudioRow } from "./api";
import type { GenericTableDef } from "./registry";
import { RowEditor } from "./RowEditor";
import { HistoryDrawer } from "./HistoryDrawer";

/** One generic-envelope Studio table (25-policy-studio.md rules 1/3): current effective rows,
 *  add/edit via draft+publish, per-row history. Column shape comes from `registry.ts`'s mirror
 *  of the backend's own TABLE_REGISTRY — the same tables `/api/studio/:table` will accept. */
export function GenericTableEditor({ table, label, def, canEdit }: { table: string; label: string; def: GenericTableDef; canEdit: boolean }) {
  const [rows, setRows] = useState<StudioRow[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<StudioRow | null | "new" | undefined>(undefined);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  function load() {
    setError(false);
    studioApi
      .listTable(table)
      .then(setRows)
      .catch(() => setError(true));
  }
  useEffect(() => {
    setRows(null); // avoid a frame of the previous table's rows rendered against the new def
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const allCols = [def.primaryKey, ...def.columns];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={label}
        description={`${table} — effective rows, edited via draft + publish`}
        actions={canEdit ? <Button onClick={() => setEditing("new")}>Add row</Button> : undefined}
      />

      {error && (
        <EmptyState icon={Table2} message={`Couldn't load ${table}.`} action={{ label: "Retry", onClick: load }} />
      )}
      {!error && rows === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && rows && rows.length === 0 && (
        <EmptyState icon={Table2} message={`No ${table} rows yet.`} action={canEdit ? { label: "Add the first row", onClick: () => setEditing("new") } : undefined} />
      )}
      {!error && rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-caption">
            <thead className="sticky top-0 bg-surface-2 text-footnote">
              <tr>
                {allCols.map((c) => (
                  <th key={c} className="whitespace-nowrap p-2">
                    {c}
                  </th>
                ))}
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pk = r[def.primaryKey] as string;
                return (
                  <tr key={pk} className="border-t border-line">
                    {allCols.map((c) => (
                      <td key={c} className="max-w-xs truncate whitespace-nowrap p-2">
                        {typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : String(r[c] ?? "—")}
                      </td>
                    ))}
                    <td className="whitespace-nowrap p-2 text-right">
                      <button onClick={() => setHistoryFor(pk)} aria-label={`History for ${pk}`} className="mr-2 rounded-lg p-1.5 text-fg-muted hover:bg-surface-2">
                        <History className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <RowEditor
          table={table}
          def={def}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}
      {historyFor && <HistoryDrawer table={table} rowId={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}
