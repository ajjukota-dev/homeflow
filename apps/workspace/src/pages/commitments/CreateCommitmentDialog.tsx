import { useState } from "react";
import { Dialog, DialogContent, Field, Input, Textarea, MoneyInput, Checkbox, Select, SelectTrigger, SelectOptions, Button } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { commitmentsApi, type CommitmentCategory } from "./api";
import { commitmentCategoryLabel } from "../../lib/labels";

// 13-promise-ledger.md Data table: source defaults to "CRM" (a manually-recorded commitment,
// distinct from the SALES_HANDOVER-sourced ones rule 6 auto-creates from 17's packet). No
// owner-picker: no endpoint lets a CRM actor list/search users (`/api/admin/users` requires
// `administration` WRITE, MANAGEMENT/SUPER_ADMIN only) — same "raw user id, no lookup" scope cut
// ActionDrawer/My-Day's Team view already flagged for the same reason.
const CATEGORIES: CommitmentCategory[] = ["MODIFICATION", "COMMERCIAL", "TIMELINE", "COMPLIMENTARY_ITEM", "SPECIFICATION_UPGRADE", "SERVICE", "OTHER"];

export function CreateCommitmentDialog({ bookingId, onClose, onCreated }: { bookingId: string; onClose: () => void; onCreated: () => void }) {
  const [category, setCategory] = useState<CommitmentCategory>("OTHER");
  const [description, setDescription] = useState("");
  const [beneficiary, setBeneficiary] = useState<"CUSTOMER" | "INTERNAL">("CUSTOMER");
  const [customerFacing, setCustomerFacing] = useState(true);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [department, setDepartment] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [financialImpact, setFinancialImpact] = useState(0);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (!description.trim()) return setError("A description is required.");
    setBusy(true);
    try {
      await commitmentsApi.create({
        booking_id: bookingId,
        category,
        description: description.trim(),
        source: "CRM",
        beneficiary,
        customer_facing: customerFacing,
        owner_user_id: ownerUserId.trim() || null,
        responsible_department: department.trim() || null,
        due_date: dueDate || null,
        financial_impact_inr: financialImpact > 0 ? financialImpact : null,
        approval_required: approvalRequired,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create this commitment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New commitment" description="Record a promise made to this customer, or an internal one tied to this booking.">
        <div className="flex flex-col gap-3">
          <Field label="Category" htmlFor="cmt-category" required>
            <Select value={category} onValueChange={(v) => setCategory(v as CommitmentCategory)}>
              <SelectTrigger id="cmt-category" />
              <SelectOptions options={CATEGORIES.map((c) => ({ value: c, label: commitmentCategoryLabel(c) }))} />
            </Select>
          </Field>
          <Field label="Description" htmlFor="cmt-description" required>
            <Textarea id="cmt-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Beneficiary" htmlFor="cmt-beneficiary" required>
              <Select value={beneficiary} onValueChange={(v) => setBeneficiary(v as "CUSTOMER" | "INTERNAL")}>
                <SelectTrigger id="cmt-beneficiary" />
                <SelectOptions options={[{ value: "CUSTOMER", label: "Customer" }, { value: "INTERNAL", label: "Internal" }]} />
              </Select>
            </Field>
            <Field label="Due date" htmlFor="cmt-due">
              <Input id="cmt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner (user id)" htmlFor="cmt-owner" hint="Optional — required before this can be activated">
              <Input id="cmt-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} placeholder="e.g. user_crm" />
            </Field>
            <Field label="Department" htmlFor="cmt-department" hint="Optional">
              <Input id="cmt-department" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
          </div>
          <Field label="Financial impact" htmlFor="cmt-impact" hint="Optional — ₹ amounts ≥ ₹2,00,000 route approval to Management">
            <MoneyInput id="cmt-impact" value={financialImpact} onChange={setFinancialImpact} />
          </Field>
          <Checkbox label="Visible to the customer" checked={customerFacing} onCheckedChange={(c) => setCustomerFacing(c === true)} />
          <Checkbox label="Needs approval before it's active" checked={approvalRequired} onCheckedChange={(c) => setApprovalRequired(c === true)} />

          {error && <p role="alert" className="text-footnote text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Creating…" : "Create commitment"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
