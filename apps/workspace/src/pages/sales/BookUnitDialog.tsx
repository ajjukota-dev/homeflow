import { useEffect, useState } from "react";
import { Dialog, DialogContent, Field, Input, MoneyInput, Select, SelectTrigger, SelectOptions, Button, RadioGroup, RadioItem } from "@homeflow/ui";
import { Plus, Trash2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesApi, type InventoryUnit, type Prospect, type ApplicantInput, type Residency, type PaymentPlan, type BookingCreated } from "./api";

const RESIDENCIES: { value: Residency; label: string }[] = [
  { value: "RESIDENT", label: "Resident" },
  { value: "NRI", label: "NRI" },
  { value: "OCI", label: "OCI" },
];

function blankApplicant(role: "PRIMARY" | "CO_APPLICANT"): ApplicantInput {
  return { display_name: "", phone: "", email: "", residency: "RESIDENT", role };
}

/** 24-sales-inventory-discovery.md rule 8 Screen "Book unit" — the highest-priority action in
 *  this spec. Real applicants/discount/payment-plan capture against sales/booking.ts::bookFromInventory. */
export function BookUnitDialog({
  unit,
  prospects,
  onClose,
  onBooked,
}: {
  unit: InventoryUnit | null;
  prospects: Prospect[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const [prospectId, setProspectId] = useState("");
  const [applicants, setApplicants] = useState<ApplicantInput[]>([blankApplicant("PRIMARY")]);
  const [price, setPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [bookingAmount, setBookingAmount] = useState(0);
  const [paymentPlanId, setPaymentPlanId] = useState("");
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BookingCreated | null>(null);

  useEffect(() => {
    if (!unit) return;
    setPrice(unit.price_inr ?? 0);
    setDiscount(0);
    setBookingAmount(0);
    setProspectId("");
    setApplicants([blankApplicant("PRIMARY")]);
    setPaymentPlanId("");
    setError(null);
    setCreated(null);
    salesApi.listPaymentPlans().then(setPlans).catch(() => setPlans([]));
  }, [unit]);

  const activeProspects = prospects.filter((p) => p.status === "ACTIVE");

  function updateApplicant(i: number, patch: Partial<ApplicantInput>) {
    setApplicants((cur) => cur.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  async function submit() {
    if (!unit) return;
    setError(null);
    if (!prospectId) return setError("Select a prospect to book against.");
    const primaries = applicants.filter((a) => (a.role ?? "PRIMARY") === "PRIMARY");
    if (primaries.length !== 1) return setError("Exactly one applicant must be the primary applicant.");
    if (applicants.some((a) => !a.display_name.trim())) return setError("Every applicant needs a name.");
    if (!(price > 0)) return setError("Price must be greater than zero.");
    setBusy(true);
    try {
      const result = await salesApi.book(prospectId, {
        unit_id: unit.unit_id,
        applicants: applicants.map((a) => ({ ...a, phone: a.phone || null, email: a.email || null })),
        price_inr: price,
        discount_inr: discount || undefined,
        booking_amount_inr: bookingAmount || undefined,
        payment_plan_id: paymentPlanId || null,
      });
      setCreated(result);
      onBooked();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Booking failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!unit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={unit ? `Book villa ${unit.unit_number}` : "Book unit"} description="Rule 8 — creates a DRAFT booking; a large discount routes to approval automatically." className="max-w-lg">
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-subhead text-fg">
              Booking <span className="font-semibold">{created.code}</span> created as DRAFT.
            </p>
            {created.approval_action_id && (
              <p className="text-footnote text-due">Discount requires approval before this booking can be confirmed.</p>
            )}
            {created.consumed_hold_ids.length > 0 && (
              <p className="text-footnote text-fg-muted">Consumed {created.consumed_hold_ids.length} active hold(s) on this unit.</p>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Prospect" htmlFor="book-prospect" required hint={activeProspects.length === 0 ? "No active prospects for this project yet — create one in Prospects first." : undefined}>
              <Select value={prospectId} onValueChange={setProspectId}>
                <SelectTrigger id="book-prospect" placeholder="Select a prospect" />
                <SelectOptions options={activeProspects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} />
              </Select>
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-subhead font-medium text-fg">Applicants</span>
                <Button variant="secondary" size="sm" onClick={() => setApplicants((cur) => [...cur, blankApplicant("CO_APPLICANT")])}>
                  <Plus className="h-3.5 w-3.5" /> Add co-applicant
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {applicants.map((a, i) => (
                  <div key={i} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">
                        {(a.role ?? "PRIMARY") === "PRIMARY" ? "Primary applicant" : "Co-applicant"}
                      </span>
                      {applicants.length > 1 && (a.role ?? "PRIMARY") !== "PRIMARY" && (
                        <button type="button" onClick={() => setApplicants((cur) => cur.filter((_, idx) => idx !== i))} aria-label="Remove applicant">
                          <Trash2 className="h-3.5 w-3.5 text-fg-subtle" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Name" htmlFor={`ap-name-${i}`} required>
                        <Input id={`ap-name-${i}`} value={a.display_name} onChange={(e) => updateApplicant(i, { display_name: e.target.value })} />
                      </Field>
                      <Field label="Phone" htmlFor={`ap-phone-${i}`}>
                        <Input id={`ap-phone-${i}`} value={a.phone ?? ""} onChange={(e) => updateApplicant(i, { phone: e.target.value })} />
                      </Field>
                      <Field label="Residency" htmlFor={`ap-res-${i}`} required className="col-span-2">
                        <RadioGroup value={a.residency} onValueChange={(v) => updateApplicant(i, { residency: v as Residency })} className="flex gap-4">
                          {RESIDENCIES.map((r) => (
                            <RadioItem key={r.value} value={r.value} label={r.label} />
                          ))}
                        </RadioGroup>
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Agreement price" htmlFor="book-price" required>
                <MoneyInput id="book-price" value={price} onChange={setPrice} />
              </Field>
              <Field label="Discount" htmlFor="book-discount">
                <MoneyInput id="book-discount" value={discount} onChange={setDiscount} />
              </Field>
              <Field label="Booking amount received" htmlFor="book-amount">
                <MoneyInput id="book-amount" value={bookingAmount} onChange={setBookingAmount} />
              </Field>
              <Field label="Payment plan" htmlFor="book-plan">
                <Select value={paymentPlanId} onValueChange={setPaymentPlanId}>
                  <SelectTrigger id="book-plan" placeholder="None selected" />
                  <SelectOptions options={plans.map((p) => ({ value: p.id, label: p.name }))} />
                </Select>
              </Field>
            </div>

            {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
            <Button onClick={submit} disabled={busy || !prospectId}>{busy ? "Booking…" : "Book unit"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
