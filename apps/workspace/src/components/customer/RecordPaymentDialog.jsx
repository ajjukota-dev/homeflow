import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatINR, todayIsoDate } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/financials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function RecordPaymentDialog({ open, onClose, bookingId, milestoneId, milestoneName, balance, onSaved }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(PAYMENT_MODES[4]);
  const [ref, setRef] = useState("");
  const [payDate, setPayDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAmount(balance != null ? String(balance) : "");
      setMode(PAYMENT_MODES[4]);
      setRef("");
      setPayDate(todayIsoDate());
      setNotes("");
      setFile(null);
    }
  }, [open, balance]);

  const onSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Amount must be positive");
    if (!ref.trim()) return toast.error("Reference number is required");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("booking_id", bookingId);
      fd.append("amount_inr", String(val));
      fd.append("tax_inr", "0");
      fd.append("payment_mode", mode);
      fd.append("reference_no", ref.trim());
      fd.append("payment_date", new Date(payDate).toISOString());
      if (milestoneId) fd.append("milestone_id", milestoneId);
      if (notes.trim()) fd.append("notes", notes.trim());
      if (file) fd.append("file", file);
      await api.post(`/payments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Payment recorded (Pending verification)");
      onSaved?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-lg" data-testid="fin-record-payment-dialog">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {milestoneName ? <>Against milestone <span className="font-medium">{milestoneName}</span> — balance {formatINR(balance || 0)}.</> : "Ad-hoc payment against the booking."}
            {" "}Recorded payments start as <span className="font-medium">Pending</span> and need Accounts to verify.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Amount (₹) *">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" data-testid="fin-payment-amount" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode *">
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-9" data-testid="fin-payment-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Payment date *">
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9" data-testid="fin-payment-date" />
            </Field>
          </div>
          <Field label="Reference number *">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Cheque no. / UTR / bank ref." className="h-9" data-testid="fin-payment-ref" />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-sm" data-testid="fin-payment-notes" />
          </Field>
          <Field label="Receipt (optional)">
            <input
              type="file"
              ref={fileRef}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.csv"
              className="hidden"
              data-testid="fin-payment-file"
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {file ? "Change file" : "Attach receipt"}
              </Button>
              {file && <span className="text-xs text-gray-600 truncate">{file.name}</span>}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving} data-testid="fin-payment-submit">
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
