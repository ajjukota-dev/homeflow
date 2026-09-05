/**
 * The four states every list and every 360 tab renders through (technical/09 §6).
 * A page that reaches review without all four fails it.
 */
import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { SkeletonTable } from "../components/Skeleton";

export interface AsyncProps<T> {
  data: T | undefined;
  error?: unknown;
  loading?: boolean;
  onRetry?: () => void;
  /** Shape-matching placeholder; defaults to a table skeleton. */
  skeleton?: ReactNode;
  empty?: { title: string; body?: string; action?: ReactNode };
  /** Decides emptiness for non-array payloads. */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

export function Async<T>({ data, error, loading, onRetry, skeleton, empty, isEmpty, children }: AsyncProps<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || data === undefined) return <>{skeleton ?? <SkeletonTable />}</>;
  const blank = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (blank) {
    return (
      <EmptyState
        title={empty?.title ?? "Nothing here yet"}
        body={empty?.body ?? "When there is something to show, it appears here."}
        action={empty?.action}
      />
    );
  }
  return <>{children(data)}</>;
}
