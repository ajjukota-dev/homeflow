import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader, Sparkles, Wallet } from "lucide-react";
import { getHome, type Home as HomeData } from "./api";
import { cn, formatINR } from "./lib/utils";
import { Keys, LegalCorner, Passport } from "./HomeExtras";

export function Home() {
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getHome().then(setHome).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Centered><div className="h-40 w-full max-w-md animate-pulse rounded-xl bg-surface-2" /></Centered>;
  if (error || !home)
    return (
      <Centered>
        <p className="text-body text-fg-muted">We couldn’t load your home just now. Please try again in a moment.</p>
      </Centered>
    );

  const firstName = home.customer_name.split(" ")[0];

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-16">
      {/* Hero */}
      <header className="pt-10">
        <p className="text-footnote font-medium text-fg-muted">{home.project_name}</p>
        <div className="mt-3 flex h-44 items-end overflow-hidden rounded-xl bg-gradient-to-br from-[#e7ddd0] to-[#cdd6cb] p-5">
          <span className="text-5xl">🏡</span>
        </div>
        <h1 className="mt-5 text-hero font-bold">Hello, {firstName}.</h1>
        <p className="mt-1 text-body text-fg-muted">
          Your home — Villa {home.unit_number}, {home.unit_type} · {home.facing} facing — is taking shape 🌱
        </p>
      </header>

      {/* T1 — Build My Home tracker */}
      <section className="mt-8">
        <h2 className="mb-3 text-title font-semibold">Building your home</h2>
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <ol className="relative">
            {home.stages.map((s, i) => (
              <li key={s.label} className="flex gap-3 pb-5 last:pb-0">
                <div className="flex flex-col items-center">
                  {s.state === "done" ? (
                    <CheckCircle2 className="h-6 w-6 text-ontrack" />
                  ) : s.state === "current" ? (
                    <Loader className="h-6 w-6 text-accent" />
                  ) : (
                    <Circle className="h-6 w-6 text-fg-subtle" />
                  )}
                  {i < home.stages.length - 1 && (
                    <span className={cn("mt-1 w-0.5 flex-1", s.state === "done" ? "bg-ontrack" : "bg-line")} />
                  )}
                </div>
                <div className="pb-1">
                  <div className={cn("text-body font-semibold", s.state === "upcoming" && "text-fg-subtle")}>
                    {s.label}
                  </div>
                  <div className="text-footnote text-fg-muted">
                    {s.state === "done" ? "Complete" : s.state === "current" ? "In progress now" : "Coming up"}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* T3 — personalisation windows */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
          <Sparkles className="h-5 w-5 text-accent" /> Make it yours
        </h2>
        <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
          {home.personalisation.map((p) => (
            <div key={p.label} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
              <span className="text-body">{p.label}</span>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-footnote font-medium",
                  p.window === "Open" ? "bg-ontrack/10 text-ontrack" : p.window === "Window closed" ? "bg-surface-2 text-fg-subtle" : "bg-due/10 text-due"
                )}
              >
                {p.window}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-footnote text-fg-subtle">
          Want a change? Ask your relationship manager while the window is open.
        </p>
      </section>

      {/* T2 — why each demand exists */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
          <Wallet className="h-5 w-5 text-accent" /> Payments
        </h2>
        {home.payments ? (
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-body text-fg-muted">Paid</span>
              <span className="text-title font-bold">{formatINR(home.payments.paid_total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-body text-fg-muted">Remaining</span>
              <span className="text-body font-semibold">{formatINR(home.payments.remaining_total)}</span>
            </div>
            <ol className="mt-5 divide-y divide-line">
              {home.payments.schedule.map((line) => (
                <li key={line.milestone_label} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-body font-semibold">{line.milestone_label}</div>
                      <p className="mt-0.5 text-footnote text-fg-muted">{line.why_now}</p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-body font-semibold tabular-nums">{formatINR(line.amount)}</div>
                      <div
                        className={cn(
                          "mt-1 text-caption font-medium",
                          line.status === "Paid" ? "text-ontrack" : line.status === "Upcoming" ? "text-fg-subtle" : "text-due"
                        )}
                      >
                        {line.status}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <p className="text-footnote text-fg-subtle">Your payment schedule appears here as milestones are reached.</p>
          </div>
        )}
      </section>

      <Passport items={home.passport} />
      <LegalCorner legal={home.legal} />
      <Keys keys={home.keys} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-6">{children}</div>;
}
