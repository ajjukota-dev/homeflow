/** Skeletons take the shape of the content (CLAUDE.md UI bar: skeletons, not spinners). */
export interface SkeletonProps {
  /** CSS length token, e.g. "1rem". Defaults to a line of body text. */
  height?: string;
  width?: string;
  className?: string;
}

export function Skeleton({ height = "1rem", width = "100%", className }: SkeletonProps) {
  return (
    <span
      className={["hf-skeleton", className ?? ""].filter(Boolean).join(" ")}
      style={{ height, width }}
      aria-hidden
      data-testid="skeleton"
    />
  );
}

/** A stand-in with the shape of a table: header plus `rows` lines. */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <span className="hf-visually-hidden">Loading…</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-3) 0" }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} height="0.875rem" width={c === 0 ? "18%" : "24%"} />
          ))}
        </div>
      ))}
    </div>
  );
}
