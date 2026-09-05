import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle } from "lucide-react";
import { cn } from "../lib/cn";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Tailwind width class, e.g. "w-32". */
  widthClass?: string;
}

export type SortDirection = "asc" | "desc";

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  density?: "compact" | "comfortable";
  sort?: { key: string; direction: SortDirection };
  onSortChange?: (key: string) => void;
  loading?: boolean;
  error?: { message: string; onRetry?: () => void };
  emptyMessage?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** Rows above this count render through a virtualised viewport (spec: >=200 rows). */
  virtualizeThreshold?: number;
  className?: string;
}

const ROW_HEIGHT = { compact: 32, comfortable: 40 } as const;

/** Table — sticky header, sortable columns, density toggle, loading/empty/error states, and
 * virtualisation past `virtualizeThreshold` rows (docs/specs/32-design-system.md primitives list). */
export function Table<T>({
  columns,
  rows,
  getRowId,
  density = "compact",
  sort,
  onSortChange,
  loading,
  error,
  emptyMessage = "Nothing here yet.",
  emptyAction,
  virtualizeThreshold = 200,
  className,
}: TableProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[density];
  const shouldVirtualize = rows.length >= virtualizeThreshold;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    enabled: shouldVirtualize,
    overscan: 8,
  });

  const headerRow = (
    <tr>
      {columns.map((col) => (
        <th
          key={col.key}
          scope="col"
          className={cn(
            "sticky top-0 z-10 border-b border-line bg-surface px-3 text-left text-ws-xs font-medium uppercase tracking-wide text-fg-muted",
            col.widthClass,
          )}
          style={{ height: rowHeight }}
        >
          {col.sortable ? (
            <button
              type="button"
              onClick={() => onSortChange?.(col.key)}
              className="inline-flex items-center gap-1 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {col.header}
              {sort?.key === col.key ? (
                sort.direction === "asc" ? (
                  <ArrowUp className="size-3" aria-hidden />
                ) : (
                  <ArrowDown className="size-3" aria-hidden />
                )
              ) : (
                <ArrowUpDown className="size-3 opacity-40" aria-hidden />
              )}
            </button>
          ) : (
            col.header
          )}
        </th>
      ))}
    </tr>
  );

  if (loading) {
    return (
      <div className={cn("rounded-card border border-line", className)}>
        <table className="w-full border-collapse">
          <thead>{headerRow}</thead>
        </table>
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="text" style={{ height: rowHeight - 12 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-card border border-line", className)}>
        <EmptyState
          icon={AlertTriangle}
          message={error.message}
          action={error.onRetry ? { label: "Retry", onClick: error.onRetry } : undefined}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn("rounded-card border border-line", className)}>
        <EmptyState message={emptyMessage} action={emptyAction} />
      </div>
    );
  }

  const renderRow = (row: T) => (
    <tr key={getRowId(row)} className="border-b border-line last:border-0 hover:bg-surface-raised">
      {columns.map((col) => (
        <td key={col.key} className="px-3 text-ws-body text-fg" style={{ height: rowHeight }}>
          {col.render(row)}
        </td>
      ))}
    </tr>
  );

  return (
    <div ref={scrollRef} className={cn("max-h-[70vh] overflow-auto rounded-card border border-line", className)}>
      <table className="w-full border-collapse">
        <thead>{headerRow}</thead>
        {shouldVirtualize ? (
          <tbody style={{ height: virtualizer.getTotalSize(), position: "relative", display: "block" }}>
            {virtualizer.getVirtualItems().map((vRow) => (
              <tr
                key={getRowId(rows[vRow.index])}
                className="absolute left-0 right-0 flex w-full border-b border-line hover:bg-surface-raised"
                style={{ height: vRow.size, transform: `translateY(${vRow.start}px)` }}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("flex items-center px-3 text-ws-body text-fg", col.widthClass ?? "flex-1")}>
                    {col.render(rows[vRow.index])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : (
          <tbody>{rows.map(renderRow)}</tbody>
        )}
      </table>
    </div>
  );
}

