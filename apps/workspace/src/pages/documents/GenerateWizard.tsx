import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, Button, Field, Select, SelectTrigger, SelectOptions, Badge, Card, CardBody } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { documentsApi, type ReadinessResult } from "./api";
import { prettifyCode, CLAUSE_TYPE_LABEL, clauseTypeTone } from "./labels";

// 22-document-factory.md Screens: "generate wizard (family -> template auto-picked with reason ->
// readiness panel with facts -> clause preview with parameters -> generate)". The template is
// resolved server-side (documents/templates.ts::resolveTemplate) — this wizard never lets the user
// pick a template directly, only a family; computeReadiness returns which template it picked.

const FACT_TONE: Record<string, string> = { BLOCKED: "text-overdue", WARNING: "text-due", INFO: "text-fg-muted" };

export function GenerateWizard({ projectId, onGenerated }: { projectId: string; onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<{ id: string; unit_number: string; applicant_name: string | null; booking_number: string }[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [family, setFamily] = useState("");
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    documentsApi.bookings(projectId).then(setBookings).catch(() => setBookings([]));
    documentsApi.templates({ project_id: projectId }).then((t) => setFamilies([...new Set(t.filter((x) => x.status === "APPROVED").map((x) => x.family_code))])).catch(() => setFamilies([]));
  }, [open, projectId]);

  useEffect(() => {
    if (!bookingId || !family) return setReadiness(null);
    setCheckingReadiness(true);
    setError(null);
    documentsApi
      .readiness(bookingId, family)
      .then(setReadiness)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't compute readiness."))
      .finally(() => setCheckingReadiness(false));
  }, [bookingId, family]);

  const canGenerate = readiness !== null && readiness.result !== "BLOCKED";

  function reset() {
    setBookingId(""); setFamily(""); setReadiness(null); setError(null);
  }

  async function generate() {
    if (!bookingId || !family) return;
    setBusy(true);
    setError(null);
    try {
      await documentsApi.generate(bookingId, family);
      setOpen(false);
      reset();
      onGenerated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  const resultTone = useMemo(() => {
    if (!readiness) return "";
    if (readiness.result === "READY") return "bg-ontrack/10 text-ontrack";
    if (readiness.result === "WARNING") return "bg-due/10 text-due";
    return "bg-overdue/10 text-overdue";
  }, [readiness]);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button onClick={() => setOpen(true)}>+ Generate document</Button>
      <DialogContent title="Generate a document" description="Select a family — the current APPROVED template for it is picked automatically (rule 1).">
        <div className="flex flex-col gap-3">
          <Field label="Booking" htmlFor="gen-booking" required>
            <Select value={bookingId} onValueChange={setBookingId}>
              <SelectTrigger id="gen-booking" placeholder="Select a booking" />
              <SelectOptions options={bookings.map((b) => ({ value: b.id, label: `Villa ${b.unit_number} — ${b.applicant_name ?? "—"} (${b.booking_number})` }))} />
            </Select>
          </Field>
          <Field label="Family" htmlFor="gen-family" required hint={families.length === 0 ? "No APPROVED templates exist yet — add one in Template Studio first." : undefined}>
            <Select value={family} onValueChange={setFamily}>
              <SelectTrigger id="gen-family" placeholder="Select a document family" />
              <SelectOptions options={families.map((f) => ({ value: f, label: prettifyCode(f) }))} />
            </Select>
          </Field>

          {checkingReadiness && <p className="text-footnote text-fg-muted" aria-busy="true">Checking readiness…</p>}

          {readiness && (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Readiness</span>
                  <Badge className={resultTone}>{readiness.result}</Badge>
                </div>
                {readiness.template && (
                  <p className="text-footnote text-fg-muted">
                    Template: {readiness.template.name} (v{readiness.template.version})
                  </p>
                )}
                {readiness.facts.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {readiness.facts.map((f, i) => (
                      <li key={i} className={`text-footnote ${FACT_TONE[f.level]}`}>
                        • {f.message}
                      </li>
                    ))}
                  </ul>
                )}
                {readiness.clauses.length > 0 && (
                  <div>
                    <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-fg-subtle">Clauses that will apply</p>
                    <div className="flex flex-wrap gap-1.5">
                      {readiness.clauses.map((c) => (
                        <Badge key={c.code} className={clauseTypeTone(c.type)}>
                          {c.title} · {CLAUSE_TYPE_LABEL[c.type] ?? c.type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button onClick={generate} disabled={busy || !canGenerate}>
            {busy ? "Generating…" : readiness?.result === "BLOCKED" ? "Blocked — fix the facts above" : "Generate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
