import { useCallback, useState } from "react";
import { CheckCircle2, Loader, Circle, Bell, Star } from "lucide-react";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { useAuth } from "../auth/AuthContext";
import { cn, formatDate } from "../lib/utils";

/** Rule 10: "check-ins (7/30/90 after handover, DLP close) are portal prompts + email; score 1–5 +
 *  comment." No dedicated "my pending check-ins" endpoint exists — this reads the generic
 *  per-user notification feed (already customer-readable) for an unread `check_in.sent` row and
 *  uses its `entity_ref` (portal/core.ts::sendCheckIn now attaches one, 2026-09-07 fix) to submit
 *  against the real check-in. */
function CheckInPrompt({ notificationId, checkInId, onDone }: { notificationId: string; checkInId: string; onDone: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!score) return;
    setBusy(true);
    try {
      await portalApi.submitCheckIn(checkInId, score, comment.trim() || undefined);
      await portalApi.markNotificationRead(notificationId);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <p className="text-body font-semibold">How's everything going?</p>
        <p className="mt-1 text-footnote text-fg-muted">We'd love to hear how things are going.</p>
        <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Rate your experience, 1 to 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={score === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setScore(n)}
              className="rounded-full p-1"
            >
              <Star className={cn("h-7 w-7", score && n <= score ? "fill-accent text-accent" : "text-fg-subtle")} />
            </button>
          ))}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything you'd like to add? (optional)"
          className="mt-3 w-full rounded-lg border border-line bg-surface p-3 text-body"
          rows={2}
        />
        <button
          onClick={submit}
          disabled={!score || busy}
          className="mt-3 w-full rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? "Sending…" : "Submit"}
        </button>
      </div>
    </section>
  );
}

/** 26-customer-portal.md Screens: "Home (next action + latest update + journey strip)". */
export function Home() {
  const { me } = useAuth();
  const { data: home, loading, error, reload } = useArea(useCallback(() => portalApi.overview(), []));
  const { data: notifications, reload: reloadNotifications } = useArea(useCallback(() => portalApi.unreadNotifications(), []));
  const pendingCheckIn = notifications?.find((n) => n.type === "check_in.sent" && n.entity_ref);
  const firstName = me?.user.display_name.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="pt-10">
        {home && <p className="text-footnote font-medium text-fg-muted">{home.project_name}</p>}
        <div className="mt-3 flex h-40 items-end overflow-hidden rounded-xl bg-gradient-to-br from-[#e7ddd0] to-[#cdd6cb] p-5">
          <span className="text-5xl">🏡</span>
        </div>
        <h1 className="mt-5 text-hero font-bold">Hello, {firstName}.</h1>
        {home && <p className="mt-1 text-body text-fg-muted">Your home — Villa {home.unit_number} — is taking shape 🌱</p>}
      </header>

      {loading && (
        <div className="mt-8 flex flex-col gap-3" role="status" aria-label="Loading">
          <div className="h-28 w-full animate-pulse rounded-xl bg-surface-2" />
          <div className="h-28 w-full animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-8 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">We couldn't load your home just now.</p>
          <button onClick={reload} className="mt-3 text-footnote font-medium text-accent">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && home && (
        <>
          {pendingCheckIn && pendingCheckIn.entity_ref && (
            <CheckInPrompt
              notificationId={pendingCheckIn.id}
              checkInId={pendingCheckIn.entity_ref.entity_id}
              onDone={reloadNotifications}
            />
          )}

          {home.next_action && (
            <section className="mt-8">
              <h2 className="mb-3 text-title font-semibold">Needs your action</h2>
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-body font-semibold">{home.next_action.title}</p>
                {home.next_action.due_date && <p className="mt-1 text-footnote text-fg-muted">Due {formatDate(home.next_action.due_date)}</p>}
              </div>
            </section>
          )}

          {home.latest_update && (
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
                <Bell className="h-5 w-5 text-accent" /> Latest update
              </h2>
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-body font-semibold">{home.latest_update.title}</p>
                <p className="mt-1 text-footnote text-fg-muted">{home.latest_update.body}</p>
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-3 text-title font-semibold">Your journey so far</h2>
            {home.journey_strip.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Your timeline will appear here once it's set up.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <ol className="relative">
                  {home.journey_strip.map((s, i) => (
                    <li key={s.label} className="flex gap-3 pb-5 last:pb-0">
                      <div className="flex flex-col items-center">
                        {s.status === "Completed" ? (
                          <CheckCircle2 className="h-6 w-6 text-ontrack" />
                        ) : s.status === "In progress" ? (
                          <Loader className="h-6 w-6 text-accent" />
                        ) : (
                          <Circle className="h-6 w-6 text-fg-subtle" />
                        )}
                        {i < home.journey_strip.length - 1 && (
                          <span className={cn("mt-1 w-0.5 flex-1", s.status === "Completed" ? "bg-ontrack" : "bg-line")} />
                        )}
                      </div>
                      <div className="pb-1">
                        <div className={cn("text-body font-semibold", s.status === "Not started" && "text-fg-subtle")}>{s.label}</div>
                        <div className="text-footnote text-fg-muted">{s.status}</div>
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
