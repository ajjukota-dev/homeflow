// 31-intelligence.md Screens — "Suggestions inbox per role ... with accept/reject." Every row is
// gated by rule 7's own "AI suggestion — review" badge and never applies itself; content per kind
// is dispatched to the matching accept flow (each kind's own apply step lives server-side, per
// llm-tasks/index.ts's own dispatch comment — this page never re-derives that logic).
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, CircleAlert } from "lucide-react";
import { PageHeader, Segmented, Tabs, TabsList, TabsTrigger, TabsContent, Badge, Button, Card, CardBody, Textarea, EmptyState, Skeleton } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { cn } from "../../lib/utils";
import { suggestionsApi, type LlmTaskRow, type LlmTaskKind } from "./api";
import { KIND_LABEL, KIND_ROLES, confidenceLabel } from "./labels";
import { CommitmentAcceptDialog } from "./CommitmentAcceptDialog";

const ALL_KINDS: LlmTaskKind[] = ["COMMITMENT_DETECTION", "COMMUNICATION_SUMMARY", "SENTIMENT", "DOCUMENT_FIELD_EXTRACTION", "DOCUMENT_INCONSISTENCY", "SNAG_ROOT_CAUSE_SUGGESTION"];

// Kinds whose accept step writes a text value the AI proposed (`applyAndReview`/
// `acceptRootCauseSuggestion` both throw "no value to accept" without one) — rule 5's literal
// "CRM accepts/edits" means the human can always supply/replace it, not just when the model
// happened to return one. Real fix, not a demo-only one: the fake-LLM adapter used whenever
// OPENAI_API_KEY is unset (llm/index.ts) never returns these fields at all (`{fake:true, echo}`),
// so a plain "Accept" button with no text input would be permanently broken in any environment
// without a live OpenAI key — caught by tracing that path before writing the e2e test, not by
// advisor.
const OVERRIDE_FIELD: Partial<Record<LlmTaskKind, string>> = {
  COMMUNICATION_SUMMARY: "summary",
  SENTIMENT: "sentiment",
  SNAG_ROOT_CAUSE_SUGGESTION: "root_cause",
};

function outputSummary(task: LlmTaskRow): string {
  switch (task.kind) {
    case "COMMITMENT_DETECTION": return (task.output.description as string) || "No promise detected in this communication.";
    case "COMMUNICATION_SUMMARY": return (task.output.summary as string) || "No summary produced — you can write one below.";
    case "SENTIMENT": return `Sentiment: ${(task.output.sentiment as string) || "not detected — set one below"}`;
    case "DOCUMENT_FIELD_EXTRACTION": {
      const fields = task.output.fields as string[] | undefined;
      return fields?.length ? `Likely fields: ${fields.join(", ")}` : "No fields identified.";
    }
    case "DOCUMENT_INCONSISTENCY": {
      const items = task.output.inconsistencies as { field: string; snapshot_value: string; source_value: string }[] | undefined;
      if (!items || items.length === 0) return "No inconsistencies found.";
      return items.map((i) => `${i.field}: "${i.snapshot_value}" vs "${i.source_value}"`).join("; ");
    }
    case "SNAG_ROOT_CAUSE_SUGGESTION": return (task.output.root_cause as string) || "No root cause suggested — you can write one below.";
  }
}

function SuggestionRow({ task, onChanged }: { task: LlmTaskRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingCommitment, setAcceptingCommitment] = useState(false);
  const overrideField = OVERRIDE_FIELD[task.kind];
  const [overrideText, setOverrideText] = useState(overrideField ? ((task.output[overrideField] as string) ?? "") : "");
  const pending = task.accepted === null;

  async function reject() {
    setBusy(true);
    setError(null);
    try { await suggestionsApi.reject(task.id); onChanged(); } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't reject."); } finally { setBusy(false); }
  }
  async function acceptSimple() {
    setBusy(true);
    setError(null);
    try { await suggestionsApi.acceptWithOverride(task.id, overrideField ? overrideText.trim() : undefined); onChanged(); } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't accept."); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI suggestion — review
          </Badge>
          <span className="text-footnote font-medium text-fg">{KIND_LABEL[task.kind]}</span>
          <span className="text-caption text-fg-subtle">{confidenceLabel(task.confidence)}</span>
          {!pending && (
            <Badge className={cn("ml-auto", task.accepted ? "bg-ontrack/10 text-ontrack" : "bg-overdue/10 text-overdue")}>
              {task.accepted ? "Accepted" : "Rejected"}
            </Badge>
          )}
        </div>
        <p className="whitespace-pre-wrap text-footnote text-fg-muted">{outputSummary(task)}</p>
        {pending && overrideField && (
          <Textarea
            aria-label={`Edit ${overrideField.replace("_", " ")} before accepting`}
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
            rows={2}
            placeholder={`Write the ${overrideField.replace("_", " ")} to record — edit or replace the AI's draft above`}
          />
        )}
        {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
        {pending && (
          <div className="flex gap-2">
            {task.kind === "COMMITMENT_DETECTION" ? (
              <Button size="sm" onClick={() => setAcceptingCommitment(true)} disabled={busy}>Review & accept</Button>
            ) : (
              <Button size="sm" onClick={acceptSimple} disabled={busy || (overrideField ? !overrideText.trim() : false)}>{busy ? "Working…" : "Accept"}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>Reject</Button>
          </div>
        )}
      </CardBody>
      {acceptingCommitment && (
        <CommitmentAcceptDialog task={task} onClose={() => setAcceptingCommitment(false)} onAccepted={() => { setAcceptingCommitment(false); onChanged(); }} />
      )}
    </Card>
  );
}

export function Suggestions({ roles }: { roles: string[] }) {
  const visibleKinds = useMemo(() => ALL_KINDS.filter((k) => KIND_ROLES[k].some((r) => roles.includes(r))), [roles]);
  const [kind, setKind] = useState<LlmTaskKind | undefined>(visibleKinds[0]);
  const [status, setStatus] = useState<"pending" | "reviewed">("pending");
  const [tasks, setTasks] = useState<LlmTaskRow[] | null>(null);
  const [error, setError] = useState(false);

  // A late-resolving fetch for a since-abandoned tab must never clobber a newer tab's data — guard
  // by request order (seq) and belt-and-suspenders filter by kind, since either an out-of-order
  // response or a stray fetch from elsewhere could otherwise render the wrong tab's rows.
  const seq = useRef(0);
  function load() {
    if (!kind) return;
    const mySeq = ++seq.current;
    setError(false);
    suggestionsApi.list(kind).then((rows) => { if (mySeq === seq.current) setTasks(rows); }).catch(() => { if (mySeq === seq.current) setError(true); });
  }
  useEffect(() => { setTasks(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  const filtered = (tasks ?? []).filter((t) => t.kind === kind && (status === "pending" ? t.accepted === null : t.accepted !== null));

  if (visibleKinds.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Suggestions" description="AI-assisted suggestions, reviewed and accepted by a human before anything is applied." />
        <EmptyState icon={CircleAlert} message="No suggestion categories are available to your role." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Suggestions" description="AI-assisted suggestions, reviewed and accepted by a human before anything is applied. Nothing here is sent to a customer or written to a record automatically (p32 §27)." />

      <Tabs value={kind} onValueChange={(v) => setKind(v as LlmTaskKind)}>
        <div className="overflow-x-auto">
          <TabsList>
            {visibleKinds.map((k) => (
              <TabsTrigger key={k} value={k} className="shrink-0 whitespace-nowrap">{KIND_LABEL[k]}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        {visibleKinds.map((k) => (
          <TabsContent key={k} value={k}>
            <div className="mb-3 flex justify-end">
              <Segmented aria-label="Filter by review status" value={status} onChange={(v) => setStatus(v as "pending" | "reviewed")} options={[{ value: "pending", label: "Pending" }, { value: "reviewed", label: "Reviewed" }]} />
            </div>

            {error && <EmptyState icon={CircleAlert} message="Couldn't load suggestions." action={{ label: "Retry", onClick: load }} />}
            {!error && tasks === null && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
              </div>
            )}
            {!error && tasks !== null && filtered.length === 0 && (
              <EmptyState icon={Sparkles} message={status === "pending" ? "No pending suggestions in this category." : "Nothing reviewed yet in this category."} />
            )}
            {!error && tasks !== null && filtered.length > 0 && (
              <div className="flex flex-col gap-2">
                {filtered.map((t) => <SuggestionRow key={t.id} task={t} onChanged={load} />)}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
