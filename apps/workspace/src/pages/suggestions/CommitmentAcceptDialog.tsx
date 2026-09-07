import { useEffect, useState } from "react";
import { Dialog, DialogContent, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Button, Skeleton } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { commitmentCategoryLabel } from "../../lib/labels";
import { suggestionsApi, type LlmTaskRow, type CommitmentEdits } from "./api";

const CATEGORIES: CommitmentEdits["category"][] = ["MODIFICATION", "COMMERCIAL", "TIMELINE", "COMPLIMENTARY_ITEM", "SPECIFICATION_UPGRADE", "SERVICE", "OTHER"];

function isCategory(v: unknown): v is CommitmentEdits["category"] {
  return typeof v === "string" && (CATEGORIES as string[]).includes(v);
}

/** Rule 5's literal "CRM accepts/edits" — never applies the raw LLM json verbatim. Resolves
 *  `task.input_ref` (a communication id) to its real booking_id before the human can even see
 *  the form, since `createCommitment` requires one and the suggestion itself doesn't carry it. */
export function CommitmentAcceptDialog({ task, onClose, onAccepted }: { task: LlmTaskRow; onClose: () => void; onAccepted: () => void }) {
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState<CommitmentEdits["category"]>(isCategory(task.output.category) ? task.output.category : "OTHER");
  const [description, setDescription] = useState(typeof task.output.description === "string" ? task.output.description : "");
  const [beneficiary, setBeneficiary] = useState<"CUSTOMER" | "INTERNAL">(task.output.beneficiary === "INTERNAL" ? "INTERNAL" : "CUSTOMER");
  const [dueDate, setDueDate] = useState(typeof task.output.due_date === "string" ? task.output.due_date : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    suggestionsApi.getCommunication(task.input_ref).then((c) => {
      if (!c.booking_id) { setLoadError(true); return; }
      setBookingId(c.booking_id);
    }).catch(() => setLoadError(true));
  }, [task.input_ref]);

  async function accept() {
    if (!bookingId || !description.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await suggestionsApi.acceptCommitment(task.id, {
        booking_id: bookingId,
        category,
        description: description.trim(),
        source: "COMMUNICATION",
        beneficiary,
        customer_facing: beneficiary === "CUSTOMER",
        due_date: dueDate || null,
        // Already human-reviewed in this dialog (rule 5's "CRM accepts/edits") — goes straight to
        // APPROVED, same as CreateCommitmentDialog.tsx's own default for a manually-typed one.
        approval_required: false,
      });
      onAccepted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't accept this suggestion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Accept detected commitment" description="Review and edit before this becomes a real, tracked commitment — nothing is created until you confirm.">
        {loadError && <p role="alert" className="text-footnote text-overdue">Couldn't resolve the booking this communication belongs to — this communication may have no booking on it.</p>}
        {!loadError && bookingId === null && (
          <div className="flex flex-col gap-2">
            <Skeleton variant="text" /><Skeleton variant="text" />
          </div>
        )}
        {!loadError && bookingId !== null && (
          <div className="flex flex-col gap-3">
            <Field label="Category" htmlFor="ai-cmt-category" required>
              <Select value={category} onValueChange={(v) => setCategory(v as CommitmentEdits["category"])}>
                <SelectTrigger id="ai-cmt-category" />
                <SelectOptions options={CATEGORIES.map((c) => ({ value: c, label: commitmentCategoryLabel(c) }))} />
              </Select>
            </Field>
            <Field label="Description" htmlFor="ai-cmt-description" required hint="Edit this — it's an AI-detected draft, not a final commitment text">
              <Textarea id="ai-cmt-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Beneficiary" htmlFor="ai-cmt-beneficiary" required>
                <Select value={beneficiary} onValueChange={(v) => setBeneficiary(v as "CUSTOMER" | "INTERNAL")}>
                  <SelectTrigger id="ai-cmt-beneficiary" />
                  <SelectOptions options={[{ value: "CUSTOMER", label: "Customer" }, { value: "INTERNAL", label: "Internal" }]} />
                </Select>
              </Field>
              <Field label="Due date" htmlFor="ai-cmt-due">
                <Input id="ai-cmt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
            {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={accept} disabled={busy || !description.trim()}>{busy ? "Creating…" : "Accept & create commitment"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
