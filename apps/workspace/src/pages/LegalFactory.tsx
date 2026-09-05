import { useCallback, useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { api } from "../api";
import type { LegalRow } from "../api-lifecycle";
import { Card, CardBody, Button } from "@homeflow/ui";
import { cn } from "../lib/utils";
import { documentStatusLabel, registrationStatusLabel } from "../lib/labels";

/** Legal Document Factory + registration workbench (legal/spec.md §3.1). */
export function LegalFactory({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<LegalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .legalQueue(projectId)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const err = e as Error & { errors?: { message: string; source_ref?: string }[] };
      const first = err.errors?.[0];
      setNotice(first ? `${first.message}${first.source_ref ? ` — fix ${first.source_ref}` : ""}` : err.message);
    }
    setBusy(null);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Document factory</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Generate from an approved template, never retype trusted values. Registration waits on financial clearance.
        </p>
      </header>
      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn’t reach the API on :3001.</CardBody>
        </Card>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-due/10 px-4 py-3 text-subhead text-due">
          {notice}
        </p>
      )}
      {loading && !error && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading legal queue">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      {!loading && rows.length === 0 && !error && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <Scale className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">No active bookings need documents yet.</p>
          </CardBody>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <LegalCard key={row.booking_id} row={row} busy={busy} run={run} />
        ))}
      </div>
    </div>
  );
}

function LegalCard({
  row,
  busy,
  run,
}: {
  row: LegalRow;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => void;
}) {
  const status = row.document?.status ?? "none";
  const id = row.document?.id;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="text-headline font-semibold">{row.customer_name}</div>
          <div className="text-footnote text-fg-muted">Villa {row.unit_number} · Agreement for sale</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-footnote font-medium", tone(status))}>
              {documentStatusLabel(status)}
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-footnote font-medium",
                row.financial.cleared ? "bg-ontrack/10 text-ontrack" : "bg-due/10 text-due"
              )}
            >
              {row.financial.cleared ? "Finance cleared" : "Waiting on finance"}
            </span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-footnote text-fg-muted">
              Registration {registrationStatusLabel(row.registration.status)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {status === "none" && (
            <Button size="sm" onClick={() => run(row.booking_id, () => api.generateAos(row.booking_id))} disabled={busy === row.booking_id}>
              Generate AOS
            </Button>
          )}
          {status === "draft" && id && (
            <Button size="sm" onClick={() => run(id, () => api.approveDoc(id))} disabled={busy === id}>
              Approve
            </Button>
          )}
          {status === "legal_approved" && id && (
            <Button size="sm" onClick={() => run(id, () => api.executeDoc(id))} disabled={busy === id}>
              Execute
            </Button>
          )}
          {(status === "executed" || status === "archived") && row.registration.status !== "completed" && (
            <Button
              size="sm"
              variant={row.financial.cleared ? "primary" : "secondary"}
              onClick={() => run(row.booking_id, () => api.completeRegistration(row.booking_id, "SRO/BNG/2026/LOCAL"))}
              disabled={busy === row.booking_id}
            >
              Complete registration
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function tone(status: string) {
  if (status === "executed" || status === "archived") return "bg-ontrack/10 text-ontrack";
  if (status === "draft" || status === "legal_approved") return "bg-due/10 text-due";
  return "bg-surface-2 text-fg-muted";
}
