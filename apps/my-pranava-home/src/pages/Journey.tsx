import { useCallback } from "react";
import { CheckCircle2, Loader, Circle } from "lucide-react";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { cn, formatDate } from "../lib/utils";

/** 26-customer-portal.md rule 4: journey stages in customer words + actions required from you. */
export function Journey() {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.journey(), []));

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="pt-10 pb-2">
        <h1 className="text-large font-bold">Journey</h1>
      </header>

      {loading && (
        <div className="mt-4 flex flex-col gap-3" role="status" aria-label="Loading">
          <div className="h-32 w-full animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">We couldn't load your journey just now.</p>
          <button onClick={reload} className="mt-3 text-footnote font-medium text-accent">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.actions_required.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-3 text-title font-semibold">Needs your action</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.actions_required.map((a) => (
                  <div key={a.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-body font-semibold">{a.title}</p>
                    <p className="text-footnote text-fg-muted">{a.due_date ? `Due ${formatDate(a.due_date)}` : "No due date set"}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-6">
            <h2 className="mb-3 text-title font-semibold">Stages</h2>
            {data.stages.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Your timeline will appear here once it's set up.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <ol className="relative">
                  {data.stages.map((s, i) => (
                    <li key={s.label} className="flex gap-3 pb-5 last:pb-0">
                      <div className="flex flex-col items-center">
                        {s.status === "Completed" ? (
                          <CheckCircle2 className="h-6 w-6 text-ontrack" />
                        ) : s.status === "In progress" ? (
                          <Loader className="h-6 w-6 text-accent" />
                        ) : (
                          <Circle className="h-6 w-6 text-fg-subtle" />
                        )}
                        {i < data.stages.length - 1 && (
                          <span className={cn("mt-1 w-0.5 flex-1", s.status === "Completed" ? "bg-ontrack" : "bg-line")} />
                        )}
                      </div>
                      <div className="pb-1">
                        <div className={cn("text-body font-semibold", s.status === "Not started" && "text-fg-subtle")}>{s.label}</div>
                        <div className="text-footnote text-fg-muted">
                          {s.status}
                          {s.expected_window ? ` · Expected ${s.expected_window}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
