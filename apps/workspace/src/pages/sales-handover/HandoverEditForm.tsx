import { useState } from "react";
import { Field, Input, Textarea, MoneyInput, Checkbox, Select, SelectTrigger, SelectOptions, Button, Badge } from "@homeflow/ui";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesHandoverApi, HandoverBlockedError, type SalesHandover, type Residency, type HandoverCommitmentInput } from "./api";
import { CompletenessChecklist, checklistItemLabel } from "./CompletenessChecklist";
import { residencyLabel, commitmentCategoryLabel } from "../../lib/labels";
import type { CommitmentCategory } from "../commitments/api";

const RESIDENCIES: Residency[] = ["RESIDENT", "NRI", "OCI"];
const CATEGORIES: CommitmentCategory[] = ["MODIFICATION", "COMMERCIAL", "TIMELINE", "COMPLIMENTARY_ITEM", "SPECIFICATION_UPGRADE", "SERVICE", "OTHER"];

const CONFIRMATION_FIELDS: { key: keyof ConfirmState; label: string }[] = [
  { key: "applicant_details_confirmed", label: "Applicant details confirmed" },
  { key: "contact_verified", label: "Contact details verified" },
  { key: "nri_status_confirmed", label: "Residency status confirmed" },
  { key: "communication_pref_confirmed", label: "Communication preference confirmed" },
  { key: "unit_confirmed", label: "Unit confirmed" },
  { key: "facing_confirmed", label: "Facing confirmed" },
  { key: "parking_confirmed", label: "Parking confirmed" },
];

interface ConfirmState {
  applicant_details_confirmed: boolean;
  contact_verified: boolean;
  nri_status_confirmed: boolean;
  communication_pref_confirmed: boolean;
  unit_confirmed: boolean;
  facing_confirmed: boolean;
  parking_confirmed: boolean;
}

function emptyCommitment(): HandoverCommitmentInput {
  return { category: "OTHER", description: "", due_date: "", beneficiary: "CUSTOMER", customer_facing: true };
}

/** DRAFT/RETURNED editable packet form (17-sales-crm-handover.md Screens). `submit` doubles as
 *  save-draft (core.ts always persists the packet + score first, even when it then throws
 *  `gate_blocked`) — there is no separate save action, so this form has exactly one button. */
export function HandoverEditForm({ h, onChanged }: { h: SalesHandover; onChanged: () => void }) {
  const p = h.packet;
  const [residency, setResidency] = useState<Residency>(p.customer_section.residency);
  const [confirm, setConfirm] = useState<ConfirmState>({
    applicant_details_confirmed: p.customer_section.applicant_details_confirmed,
    contact_verified: p.customer_section.contact_verified,
    nri_status_confirmed: p.customer_section.nri_status_confirmed,
    communication_pref_confirmed: p.customer_section.communication_pref_confirmed,
    unit_confirmed: p.unit_section.unit_confirmed,
    facing_confirmed: p.unit_section.facing_confirmed,
    parking_confirmed: p.unit_section.parking_confirmed,
  });
  const [discount, setDiscount] = useState(p.commercial_section.discount_inr);
  const [brokerage, setBrokerage] = useState(p.commercial_section.brokerage);
  const [paymentPlanRef, setPaymentPlanRef] = useState(p.commercial_section.payment_plan_ref ?? "");
  const [commitments, setCommitments] = useState<HandoverCommitmentInput[]>(p.commitments_section);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);

  function updateCommitment(i: number, patch: Partial<HandoverCommitmentInput>) {
    setCommitments((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setBlockers(null);
    try {
      await salesHandoverApi.submit(h.booking_id, {
        residency,
        confirmations: confirm,
        commercial: { discount_inr: discount, brokerage, payment_plan_ref: paymentPlanRef.trim() || null },
        commitments: commitments.filter((c) => c.description.trim().length > 0),
      });
    } catch (e) {
      if (e instanceof HandoverBlockedError) setBlockers(e.blockers);
      else if (e instanceof ApiError) setError(e.message);
      else setError("That didn't work.");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {h.status === "RETURNED" && h.return_reason_code && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-footnote text-warn-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Returned by CRM: {h.return_note || h.return_reason_code}
        </p>
      )}

      <CompletenessChecklist score={h.completeness_score} detail={h.completeness_detail} />

      {blockers && blockers.length > 0 && (
        <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger-fg">
          <p className="font-medium">Saved, but not submitted — still missing:</p>
          <ul className="mt-1 list-disc pl-4">
            {blockers.map((b) => (
              <li key={b}>{checklistItemLabel(b)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-ws-sm font-medium text-fg">Customer</h3>
        <Field label="Residency" htmlFor="ho-residency" required>
          <Select value={residency} onValueChange={(v) => setResidency(v as Residency)}>
            <SelectTrigger id="ho-residency" />
            <SelectOptions options={RESIDENCIES.map((r) => ({ value: r, label: residencyLabel(r) }))} />
          </Select>
        </Field>
        <div className="flex flex-col gap-2">
          {CONFIRMATION_FIELDS.map((f) => (
            <Checkbox key={f.key} label={f.label} checked={confirm[f.key]} onCheckedChange={(c) => setConfirm((s) => ({ ...s, [f.key]: c === true }))} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-ws-sm font-medium text-fg">Commercial</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Final price" htmlFor="ho-final-price" hint="Set at booking — read only here">
            <Input id="ho-final-price" disabled readOnly value={p.commercial_section.final_price_inr == null ? "—" : `₹${p.commercial_section.final_price_inr.toLocaleString("en-IN")}`} />
          </Field>
          <Field label="Booking amount" htmlFor="ho-booking-amount" hint="Set at booking — read only here">
            <Input id="ho-booking-amount" disabled readOnly value={p.commercial_section.booking_amount_inr == null ? "—" : `₹${p.commercial_section.booking_amount_inr.toLocaleString("en-IN")}`} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount" htmlFor="ho-discount">
            <MoneyInput id="ho-discount" value={discount} onChange={setDiscount} />
          </Field>
          <Field label="Brokerage" htmlFor="ho-brokerage">
            <MoneyInput id="ho-brokerage" value={brokerage} onChange={setBrokerage} />
          </Field>
        </div>
        <Field label="Payment plan reference" htmlFor="ho-payment-plan">
          <Input id="ho-payment-plan" value={paymentPlanRef} onChange={(e) => setPaymentPlanRef(e.target.value)} />
        </Field>
        {p.commercial_section.approved_deviations.length > 0 && (
          <p className="text-footnote text-fg-muted">
            Approved deviations: {p.commercial_section.approved_deviations.map((d) => `${d.domain} by ${d.approver} (${d.ref})`).join("; ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-ws-sm font-medium text-fg">Documents</h3>
        <p className="text-footnote text-fg-muted">Captured at booking — this section is read only here.</p>
        {p.documents_section.length === 0 ? (
          <p className="text-footnote text-fg-muted">No documents captured on this booking yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {p.documents_section.map((d) => (
              <Badge key={d.type} tone={d.received ? "accent" : "neutral"}>
                {d.received ? "✓ " : ""}
                {d.type}
              </Badge>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-ws-sm font-medium text-fg">Commitments made during sales</h3>
          <Button size="sm" variant="secondary" onClick={() => setCommitments((rows) => [...rows, emptyCommitment()])}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {commitments.length === 0 && <p className="text-footnote text-fg-muted">None recorded — add one if a promise was made to this customer during sales.</p>}
        {commitments.map((c, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="grid flex-1 grid-cols-2 gap-2">
                <Select value={c.category} onValueChange={(v) => updateCommitment(i, { category: v })}>
                  <SelectTrigger />
                  <SelectOptions options={CATEGORIES.map((cat) => ({ value: cat, label: commitmentCategoryLabel(cat) }))} />
                </Select>
                <Input type="date" value={c.due_date} onChange={(e) => updateCommitment(i, { due_date: e.target.value })} />
              </div>
              <Button size="sm" variant="ghost" aria-label="Remove commitment" onClick={() => setCommitments((rows) => rows.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Textarea placeholder="What was promised" value={c.description} onChange={(e) => updateCommitment(i, { description: e.target.value })} rows={2} />
            <div className="flex flex-wrap items-center gap-3">
              <Select value={c.beneficiary} onValueChange={(v) => updateCommitment(i, { beneficiary: v as "CUSTOMER" | "INTERNAL" })}>
                <SelectTrigger />
                <SelectOptions options={[{ value: "CUSTOMER", label: "Customer" }, { value: "INTERNAL", label: "Internal" }]} />
              </Select>
              <Checkbox label="Visible to customer" checked={c.customer_facing} onCheckedChange={(checked) => updateCommitment(i, { customer_facing: checked === true })} />
            </div>
          </div>
        ))}
      </section>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button onClick={submit} loading={busy}>
          {h.status === "RETURNED" ? "Resubmit for CRM review" : "Submit for CRM review"}
        </Button>
      </div>
    </div>
  );
}
