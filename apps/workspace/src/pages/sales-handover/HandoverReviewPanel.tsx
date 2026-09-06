import { useEffect, useState } from "react";
import { Field, Textarea, Select, SelectTrigger, SelectOptions, Button, KeyValue } from "@homeflow/ui";
import { CircleAlert, CheckCircle2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesHandoverApi, type SalesHandover, type ReturnReason } from "./api";
import { CompletenessChecklist } from "./CompletenessChecklist";
import { residencyLabel, commitmentCategoryLabel } from "../../lib/labels";

function fmtMoney(n: number | null): string {
  return n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;
}

/** Read-only packet summary shared by the SUBMITTED review view and the terminal ACCEPTED view.
 *  Same "let the server say no" precedent as CommitmentDrawer — buttons render unconditionally
 *  for this status, and a 403 (e.g. SALES trying to Accept) surfaces inline rather than being
 *  simulated client-side. */
function PacketSummary({ h }: { h: SalesHandover }) {
  const p = h.packet;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-ws-sm font-medium text-fg">Customer</h3>
        <KeyValue
          items={[
            { key: "Name", value: p.customer_section.display_name ?? "—" },
            { key: "Phone", value: p.customer_section.phone ?? "—" },
            { key: "PAN", value: p.customer_section.pan ?? "—" },
            { key: "Residency", value: residencyLabel(p.customer_section.residency) },
          ]}
        />
      </section>
      <section>
        <h3 className="mb-2 text-ws-sm font-medium text-fg">Commercial</h3>
        <KeyValue
          items={[
            { key: "Final price", value: fmtMoney(p.commercial_section.final_price_inr) },
            { key: "Discount", value: fmtMoney(p.commercial_section.discount_inr) },
            { key: "Brokerage", value: fmtMoney(p.commercial_section.brokerage) },
            { key: "Payment plan", value: p.commercial_section.payment_plan_ref ?? "—" },
          ]}
        />
      </section>
      <section>
        <h3 className="mb-2 text-ws-sm font-medium text-fg">Unit</h3>
        <KeyValue
          items={[
            { key: "Unit", value: p.unit_section.unit_number ?? "—" },
            { key: "Type", value: p.unit_section.unit_type ?? "—" },
            { key: "Facing", value: p.unit_section.facing ?? "—" },
          ]}
        />
      </section>
      {p.commitments_section.length > 0 && (
        <section>
          <h3 className="mb-2 text-ws-sm font-medium text-fg">Commitments made during sales</h3>
          <ul className="flex flex-col gap-1.5 text-footnote text-fg-muted">
            {p.commitments_section.map((c, i) => (
              <li key={i}>
                {commitmentCategoryLabel(c.category)}: {c.description} — due {c.due_date || "—"}
              </li>
            ))}
          </ul>
        </section>
      )}
      <CompletenessChecklist score={h.completeness_score} detail={h.completeness_detail} />
    </div>
  );
}

function ReturnForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [reasons, setReasons] = useState<ReturnReason[] | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesHandoverApi.returnReasons().then((r) => {
      setReasons(r);
      if (r[0]) setCode(r[0].code);
    });
  }, []);

  async function confirmReturn() {
    if (!code) return setError("Choose a reason.");
    setBusy(true);
    setError(null);
    try {
      await salesHandoverApi.return(bookingId, code, note.trim());
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
      <Field label="Reason" htmlFor="ho-return-reason" required>
        <Select value={code} onValueChange={setCode}>
          <SelectTrigger id="ho-return-reason" />
          <SelectOptions options={(reasons ?? []).map((r) => ({ value: r.code, label: r.label }))} />
        </Select>
      </Field>
      <Field label="Note" htmlFor="ho-return-note" hint="Optional — visible to Sales">
        <Textarea id="ho-return-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="danger" onClick={confirmReturn} loading={busy}>
          Confirm return
        </Button>
      </div>
    </div>
  );
}

export function HandoverReviewPanel({ h, onChanged }: { h: SalesHandover; onChanged: () => void }) {
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await salesHandoverApi.accept(h.booking_id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work.");
      setBusy(false);
    }
  }

  if (h.status === "ACCEPTED") {
    return (
      <div className="flex flex-col gap-5">
        <p className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-footnote text-ok-fg">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Accepted{h.first_time_right ? " — first time right" : " — required at least one return before acceptance"}
        </p>
        <PacketSummary h={h} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <PacketSummary h={h} />
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div role="group" aria-label="Available actions" className="flex flex-wrap gap-2">
          <Button size="sm" onClick={accept} loading={busy}>
            Accept
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReturning((v) => !v)}>
            Return to Sales
          </Button>
        </div>
        {returning && <ReturnForm bookingId={h.booking_id} onDone={onChanged} />}
      </div>
    </div>
  );
}
