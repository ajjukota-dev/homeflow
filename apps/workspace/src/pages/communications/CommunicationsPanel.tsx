// 29-communications.md Screens — Customer 360's own Communications tab, upgraded from 28's
// read-only embed to the real interactive surface: log/send/publish. Visibility is always icon +
// label (CLAUDE.md "status never by colour alone"), never colour-only.
import { useEffect, useState } from "react";
import { Phone, Mail, Send, Lock, Eye, CircleAlert, MessageSquare, Sparkles } from "lucide-react";
import { Button, Badge, EmptyState, Skeleton, Dialog, DialogContent } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { communicationsApi, CHANNEL_LABEL, type CommunicationRow } from "./api";
import { suggestionsApi } from "../suggestions/api";
import { LogCommunicationDrawer } from "./LogCommunicationDrawer";
import { SendEmailDrawer } from "./SendEmailDrawer";

const WRITE_ROLES = ["SALES", "CRM", "SUPER_ADMIN"];
const PUBLISH_ROLES = ["CRM", "MANAGEMENT", "SUPER_ADMIN"];
// 31-intelligence.md rule 5's own trigger points aren't specified by that spec (it only says
// suggestions are "on logged communications") — CRM is this feature's own write role, reused
// here rather than inventing a separate gate for "who may spend LLM budget."
const ANALYZE_ROLES = WRITE_ROLES;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function CommunicationsPanel({ customerId, bookingId, customerEmail, roles }: { customerId: string; bookingId?: string | null; customerEmail?: string | null; roles: string[] }) {
  const [items, setItems] = useState<CommunicationRow[] | null>(null);
  const [error, setError] = useState(false);
  const [logging, setLogging] = useState(false);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState<CommunicationRow | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzeNotice, setAnalyzeNotice] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const canPublish = roles.some((r) => PUBLISH_ROLES.includes(r));
  const canAnalyze = roles.some((r) => ANALYZE_ROLES.includes(r));

  async function analyze(c: CommunicationRow, kind: "COMMITMENT_DETECTION" | "COMMUNICATION_SUMMARY" | "SENTIMENT") {
    setAnalyzing(`${c.id}:${kind}`);
    setAnalyzeNotice(null);
    try {
      await suggestionsApi.create(kind, c.id);
      setAnalyzeNotice({ id: c.id, text: "Suggestion created — review it under Suggestions.", ok: true });
    } catch (e) {
      setAnalyzeNotice({ id: c.id, text: e instanceof ApiError ? e.message : "Couldn't run that analysis.", ok: false });
    } finally {
      setAnalyzing(null);
    }
  }

  function load() {
    setError(false);
    communicationsApi.listForCustomer(customerId).then(setItems).catch(() => setError(true));
  }
  useEffect(load, [customerId]);

  async function confirmPublish() {
    if (!publishing) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      await communicationsApi.publishToPortal(publishing.id);
      setPublishing(null);
      load();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Couldn't publish that.");
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setLogging(true)}>
              <Phone className="h-4 w-4" /> Log a call/meeting
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSending(true)}>
              <Mail className="h-4 w-4" /> Send email
            </Button>
          </>
        )}
      </div>

      {error && <EmptyState icon={CircleAlert} message="Couldn't load communications." action={{ label: "Retry", onClick: load }} />}
      {!error && items === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && items !== null && items.length === 0 && <EmptyState icon={MessageSquare} message="No communications logged yet." />}
      {!error && items !== null && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex flex-wrap items-start gap-2">
                <Badge tone="neutral">{CHANNEL_LABEL[c.channel]}</Badge>
                <span className="text-caption text-fg-subtle">{c.direction === "INBOUND" ? "From customer" : "To customer"}</span>
                <Badge tone={c.visibility === "CUSTOMER_VISIBLE" ? "accent" : "neutral"} className="inline-flex items-center gap-1">
                  {c.visibility === "CUSTOMER_VISIBLE" ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {c.visibility === "CUSTOMER_VISIBLE" ? "Customer can see this" : "Internal only"}
                </Badge>
                <time className="ml-auto shrink-0 text-caption text-fg-subtle" dateTime={c.occurred_at}>{relativeTime(c.occurred_at)}</time>
              </div>
              {c.subject && <p className="mt-2 text-footnote font-semibold text-fg">{c.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-footnote text-fg-muted">{c.body}</p>
              {c.follow_up_required && (
                <p className="mt-2 text-caption text-atrisk">Follow-up needed{c.follow_up_due ? ` by ${new Date(c.follow_up_due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canPublish && c.visibility === "INTERNAL" && c.booking_id && (
                  <Button size="sm" variant="ghost" onClick={() => setPublishing(c)}>
                    <Send className="h-3.5 w-3.5" /> Publish to portal
                  </Button>
                )}
                {canAnalyze && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => analyze(c, "COMMITMENT_DETECTION")} disabled={analyzing !== null}>
                      <Sparkles className="h-3.5 w-3.5" /> {analyzing === `${c.id}:COMMITMENT_DETECTION` ? "Detecting…" : "Detect commitment"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => analyze(c, "COMMUNICATION_SUMMARY")} disabled={analyzing !== null}>
                      <Sparkles className="h-3.5 w-3.5" /> {analyzing === `${c.id}:COMMUNICATION_SUMMARY` ? "Summarizing…" : "Summarize"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => analyze(c, "SENTIMENT")} disabled={analyzing !== null}>
                      <Sparkles className="h-3.5 w-3.5" /> {analyzing === `${c.id}:SENTIMENT` ? "Analyzing…" : "Sentiment"}
                    </Button>
                  </>
                )}
              </div>
              {analyzeNotice && analyzeNotice.id === c.id && (
                <p role={analyzeNotice.ok ? "status" : "alert"} className={`mt-1 text-footnote ${analyzeNotice.ok ? "text-fg-muted" : "text-overdue"}`}>
                  {analyzeNotice.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <LogCommunicationDrawer open={logging} onOpenChange={setLogging} customerId={customerId} bookingId={bookingId} onLogged={load} />
      <SendEmailDrawer open={sending} onOpenChange={setSending} customerId={customerId} bookingId={bookingId} defaultTo={customerEmail} roles={roles} onSent={load} />

      <Dialog open={!!publishing} onOpenChange={(o) => { if (!o) { setPublishing(null); setPublishError(null); } }}>
        {publishing && (
          <DialogContent title="Publish to the customer portal" description="This will appear in the customer's portal immediately — exactly as shown below.">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                {publishing.subject && <p className="text-footnote font-semibold text-fg">{publishing.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap text-footnote text-fg-muted">{publishing.body}</p>
              </div>
              {publishError && <p role="alert" className="text-footnote text-overdue">{publishError}</p>}
              <div className="flex gap-2">
                <Button onClick={confirmPublish} disabled={publishBusy}>{publishBusy ? "Publishing…" : "Publish"}</Button>
                <Button variant="ghost" onClick={() => setPublishing(null)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
