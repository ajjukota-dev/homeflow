import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Consistent title bar + loading/error chrome for every portal sub-screen reached from "More"
 *  (Registration, Handover, Requests, Commitments, Home Passport, Profile). Home/Journey/
 *  Payments/Documents sit on the bottom tab bar so they render their own header. */
export function AreaScreen({
  title,
  onBack,
  loading,
  error,
  onRetry,
  empty,
  children,
}: {
  title: string;
  onBack: () => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="flex items-center gap-2 pt-8 pb-2">
        <button onClick={onBack} aria-label="Back" className="-ml-2 rounded-full p-2 hover:bg-surface-2">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-title font-semibold">{title}</h1>
      </header>

      {loading && (
        <div className="mt-4 flex flex-col gap-3" role="status" aria-label="Loading">
          <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
          <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">We couldn't load this just now.</p>
          <button onClick={onRetry} className="mt-3 text-footnote font-medium text-accent">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">Nothing here yet.</p>
        </div>
      )}

      {!loading && !error && !empty && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "danger" | "neutral"; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-ontrack/10 text-ontrack"
      : tone === "warn"
        ? "bg-due/10 text-due"
        : tone === "danger"
          ? "bg-danger/10 text-danger"
          : "bg-surface-2 text-fg-subtle";
  return <span className={`rounded-full px-3 py-1 text-footnote font-medium ${cls}`}>{children}</span>;
}
