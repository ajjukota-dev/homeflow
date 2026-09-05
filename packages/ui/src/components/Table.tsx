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
  /** Fixed column width in px. Omit for a flexible column (shares remaining space). */
  width?: number;
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

function gridTemplate<T>(columns: TableColumn<T>[]): string {
  return columns.map((c) => (c.width ? `${c.width}px` : "minmax(140px,1fr)")).join(" ");
}

function SortButton({ label, active, direction, onClick }: { label: string; active: boolean; direction?: SortDirection; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {label}
      {active ? (
        direction === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" aria-hidden />
      )}
    </button>
  );
}

/** Table — sticky header, sortable columns, density toggle, loading/empty/error states, and
 * virtualisation past `virtualizeThreshold` rows (docs/specs/32-design-system.md primitives list).
 * The virtualised path renders header + rows as a CSS Grid (`role="table"/"row"/"cell"`) instead
 * of real `<table>` markup — mixing a table-layout header with absolutely-positioned body rows
 * (needed for virtualisation) makes browsers size the two independently and columns drift apart. */
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

  if (loading) {
    return (
      <div className={cn("rounded-card border border-line", className)}>
        <div className="flex border-b border-line px-3" style={{ height: rowHeight }}>
          {columns.map((col) => (
            <span key={col.key} className="flex items-center text-ws-xs font-medium uppercase tracking-wide text-fg-muted">
              {col.header}
            </span>
          ))}
        </div>
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

  if (shouldVirtualize) {
    const template = gridTemplate(columns);
    return (
      <div
        ref={scrollRef}
        role="table"
        aria-rowcount={rows.length}
        className={cn("max-h-[70vh] overflow-auto rounded-card border border-line", className)}
      >
        <div
          role="row"
          className="sticky top-0 z-10 grid border-b border-line bg-surface"
          style={{ gridTemplateColumns: template, height: rowHeight }}
        >
          {columns.map((col) => (
            <div
              key={col.key}
              role="columnheader"
              className="flex items-center px-3 text-ws-xs font-medium uppercase tracking-wide text-fg-muted"
            >
              {col.sortable ? (
                <SortButton
                  label={col.header}
                  active={sort?.key === col.key}
                  direction={sort?.key === col.key ? sort.direction : undefined}
                  onClick={() => onSortChange?.(col.key)}
                />
              ) : (
                col.header
              )}
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            return (
              <div
                key={getRowId(row)}
                role="row"
                className="absolute left-0 top-0 grid w-full border-b border-line last:border-0 hover:bg-surface-raised"
                style={{ gridTemplateColumns: template, height: vRow.size, transform: `translateY(${vRow.start}px)` }}
              >
                {columns.map((col) => (
                  <div key={col.key} role="cell" className="flex items-center overflow-hidden px-3 text-ws-body text-fg">
                    <span className="truncate">{col.render(row)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("max-h-[70vh] overflow-auto rounded-card border border-line", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{ height: rowHeight, width: col.width }}
                className="sticky top-0 z-10 border-b border-line bg-surface px-3 text-left text-ws-xs font-medium uppercase tracking-wide text-fg-muted"
              >
                {col.sortable ? (
                  <SortButton
                    label={col.header}
                    active={sort?.key === col.key}
                    direction={sort?.key === col.key ? sort.direction : undefined}
                    onClick={() => onSortChange?.(col.key)}
                  />
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowId(row)} className="border-b border-line last:border-0 hover:bg-surface-raised">
              {columns.map((col) => (
                <td key={col.key} style={{ height: rowHeight, width: col.width }} className="px-3 text-ws-body text-fg">
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
