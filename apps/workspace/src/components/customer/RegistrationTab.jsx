import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  FileSignature,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Upload,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { REG_STATUS_TONE, canBookSlot, canConfirmAvailability } from "@/lib/phase6";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
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

export default function RegistrationTab({ customerId, bookings }) {
  const { user } = useAuth();
  const confirmed = useMemo(
    () => (bookings || []).filter((b) => b.status === "Confirmed"),
    [bookings],
  );
  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  const [reg, setReg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showBook, setShowBook] = useState(false);
  const [showExecute, setShowExecute] = useState(false);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [prefDatesText, setPrefDatesText] = useState("");
  const [sroText, setSroText] = useState("");

  useEffect(() => {
    if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id);
  }, [confirmed, bookingId]);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const r = await api.get(`/registrations/booking/${bookingId}`);
      setReg(r.data);
      setPrefDatesText((r.data?.preferred_dates || []).join(", "));
      setSroText(r.data?.sro_office || "");
    } catch (e) { apiErrorToast(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  if (confirmed.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center" data-testid="reg-empty">
        <FileSignature className="h-6 w-6 text-gray-300 mx-auto" />
        <div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div>
      </div>
    );
  }

  const savePreferences = async () => {
    if (!reg) return;
    const parts = prefDatesText.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await api.patch(`/registrations/${reg.id}`, { preferred_dates: parts, sro_office: sroText || null });
      toast.success("Saved");
      load();
    } catch (e) { apiErrorToast(e); }
  };

  const uploadDeed = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !reg) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/registrations/${reg.id}/upload-registered-deed`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Registered deed uploaded — registration Closed");
      load();
    } catch (err) { apiErrorToast(err); }
    finally { setUploading(false); }
  };

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6" data-testid="registration-tab">
      <div className="space-y-4 min-w-0">
        {confirmed.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Booking</span>
            <Select value={bookingId || ""} onValueChange={setBookingId}>
              <SelectTrigger className="h-8 w-72 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {confirmed.map((b) => <SelectItem key={b.id} value={b.id}><span className="font-mono text-xs">{b.code}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-gray-500 p-6">Loading registration…</div>
        ) : reg && (
          <>
            <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="reg-header">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <FileSignature className="h-4 w-4 text-navy-900" />
                    Sub-registrar registration
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {reg.slot_date ? `SRO ${reg.sro_office || "—"} · ${formatDate(reg.slot_date)} ${reg.slot_time || ""}` : "No slot booked yet"}
                  </div>
                </div>
                <StatusPill status={reg.status} tone={REG_STATUS_TONE[reg.status] || "grey"} testId="reg-status-pill" />
              </div>
            </div>

            <ReadinessGates readiness={reg.readiness} customerId={customerId} />

            {reg.status === "Not Started" || reg.status === "Availability Confirmed" ? (
              <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3" data-testid="reg-plan-block">
                <div className="text-sm font-medium text-gray-900">Plan the slot</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Sub-registrar office"><Input value={sroText} onChange={(e) => setSroText(e.target.value)} placeholder="e.g. SRO Banjara Hills" className="h-9" data-testid="reg-sro-input" /></Field>
                  <Field label="Customer preferred dates (comma-separated ISO)"><Input value={prefDatesText} onChange={(e) => setPrefDatesText(e.target.value)} placeholder="2026-09-01, 2026-09-02" className="h-9" data-testid="reg-pref-dates" /></Field>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={savePreferences} data-testid="reg-save-prefs">Save preferences</Button>
                  {canConfirmAvailability(user) && (
                    <Button size="sm" onClick={() => setShowConfirm(true)} disabled={!reg.readiness?.legal_ready} title={reg.readiness?.legal_ready ? "" : "Legal approval (T6) required first"} data-testid="reg-confirm-btn">
                      <CalendarClock className="h-3.5 w-3.5" /> Confirm availability
                    </Button>
                  )}
                  {canBookSlot(user) && reg.status === "Availability Confirmed" && (
                    <Button
                      size="sm"
                      onClick={() => setShowBook(true)}
                      disabled={!(reg.readiness?.legal_ready && reg.readiness?.tds_ready && reg.readiness?.fc_ready)}
                      title={
                        !reg.readiness?.legal_ready ? "Legal approval required" :
                        !reg.readiness?.tds_ready ? "TDS verified / NA required" :
                        !reg.readiness?.fc_ready ? "Financial clearance required" :
                        ""
                      }
                      data-testid="reg-book-btn"
                    >
                      <FileSignature className="h-3.5 w-3.5" /> Book SRO slot
                    </Button>
                  )}
                </div>
              </div>
            ) : null}

            {reg.status === "Slot Booked" && (
              <div className="rounded-md border border-purple-200 bg-purple-50 p-4 space-y-2" data-testid="reg-slot-booked">
                <div className="text-sm text-purple-900 font-medium">Slot confirmed</div>
                <div className="text-xs text-purple-800">Ref: <span className="font-mono">{reg.slot_reference_no}</span> · {reg.sro_office} · {formatDate(reg.slot_date)} at {reg.slot_time}</div>
                {canBookSlot(user) && (
                  <Button size="sm" onClick={() => setShowExecute(true)} className="mt-2" data-testid="reg-mark-executed-btn">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark as executed
                  </Button>
                )}
              </div>
            )}

            {reg.status === "Executed" && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4" data-testid="reg-executed">
                <div className="text-sm text-emerald-900 font-medium">Registration executed on {formatDate(reg.executed_date)}</div>
                <div className="text-xs text-emerald-800 mt-1">Doc #: <span className="font-mono">{reg.registration_document_number}</span> · Rep: {reg.company_representative}</div>
                {reg.outcome_notes && <div className="text-xs text-emerald-800 mt-1 italic">{reg.outcome_notes}</div>}
                {canBookSlot(user) && (
                  <>
                    <input type="file" ref={fileRef} onChange={uploadDeed} accept=".pdf,.jpg,.jpeg,.png" className="hidden" data-testid="reg-deed-file" />
                    <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-3" data-testid="reg-upload-deed-btn">
                      <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload registered sale deed"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {reg.status === "Closed" && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-2" data-testid="reg-closed">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <div className="text-sm text-emerald-900">
                  <span className="font-medium">Closed.</span> Registered deed on file. Doc #: <span className="font-mono">{reg.registration_document_number}</span>.
                </div>
              </div>
            )}

            <ConfirmModal
              open={showConfirm} onClose={() => setShowConfirm(false)}
              onSubmit={async (confirmed_date) => { try { await api.post(`/registrations/${reg.id}/confirm-availability`, { confirmed_date }); toast.success("Availability confirmed · T9 cascade fired"); setShowConfirm(false); load(); } catch (e) { apiErrorToast(e); } }}
            />
            <BookSlotModal
              open={showBook} onClose={() => setShowBook(false)} defaultSro={reg.sro_office || ""}
              onSubmit={async (payload) => { try { await api.post(`/registrations/${reg.id}/book-slot`, payload); toast.success("Slot booked · T10 cascade fired"); setShowBook(false); load(); } catch (e) { apiErrorToast(e); } }}
            />
            <ExecuteModal
              open={showExecute} onClose={() => setShowExecute(false)}
              onSubmit={async (payload) => { try { await api.post(`/registrations/${reg.id}/mark-executed`, payload); toast.success("Registration executed"); setShowExecute(false); load(); } catch (e) { apiErrorToast(e); } }}
            />
          </>
        )}
      </div>

      {reg && (
        <CollaborationPanel entityType="registration" entityId={reg.id} entityTitle="Registration" />
      )}
    </div>
  );
}

function ReadinessGates({ readiness, customerId }) {
  if (!readiness) return null;
  const gates = [
    { key: "legal_ready", label: "Legal approval (T6)", detail: `Status: ${readiness.legal_status}`, fix: `/customers/${customerId}?tab=legal` },
    { key: "tds_ready", label: "TDS verified (or Not Applicable)", detail: `TDS: ${readiness.tds_status} · verify: ${readiness.tds_verification}`, fix: `/customers/${customerId}?tab=financials` },
    { key: "fc_ready", label: "Financial clearance approved", detail: `FC: ${readiness.fc_status}`, fix: `/customers/${customerId}?tab=financials` },
    { key: "avail_ready", label: "Customer availability confirmed", detail: "T9 must be Completed", fix: null, alwaysGreen: readiness.legal_ready },
  ];
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="reg-readiness">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-900">Book Slot readiness</div>
      <ul className="divide-y divide-gray-100">
        {gates.slice(0, 3).map((g) => {
          const ok = readiness[g.key];
          return (
            <li key={g.key} className="px-4 py-2 flex items-center gap-3 text-sm" data-testid={`reg-gate-${g.key}`}>
              {ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-gray-900">{g.label}</div>
                <div className="text-[11px] text-gray-500">{g.detail}</div>
              </div>
              {!ok && g.fix && (
                <Link to={g.fix} className="text-[11px] text-navy-900 hover:underline inline-flex items-center gap-1" data-testid={`reg-gate-${g.key}-fix`}>
                  Open <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfirmModal({ open, onClose, onSubmit }) {
  const [date, setDate] = useState("");
  useEffect(() => { if (open) setDate(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="reg-confirm-modal">
        <DialogHeader><DialogTitle>Confirm customer availability</DialogTitle><DialogDescription>Pick the date the customer has confirmed. Cascade-completes journey task T9.</DialogDescription></DialogHeader>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" data-testid="reg-confirm-date" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => date && onSubmit(new Date(date).toISOString())} disabled={!date} data-testid="reg-confirm-submit">Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookSlotModal({ open, onClose, defaultSro, onSubmit }) {
  const [f, setF] = useState({ slot_date: "", slot_time: "", sro_office: "", slot_reference_no: "" });
  useEffect(() => { if (open) setF({ slot_date: "", slot_time: "10:00", sro_office: defaultSro || "", slot_reference_no: "" }); }, [open, defaultSro]);
  const submit = () => {
    if (!f.slot_date || !f.slot_time || !f.sro_office || !f.slot_reference_no) return toast.error("All fields required");
    onSubmit({
      slot_date: new Date(f.slot_date).toISOString(),
      slot_time: f.slot_time,
      sro_office: f.sro_office,
      slot_reference_no: f.slot_reference_no,
    });
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="reg-book-modal">
        <DialogHeader><DialogTitle>Book SRO slot</DialogTitle><DialogDescription>Cascade-completes journey task T10 on success.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Sub-registrar office *"><Input value={f.sro_office} onChange={(e) => setF((s) => ({ ...s, sro_office: e.target.value }))} className="h-9" data-testid="reg-book-sro" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Slot date *"><Input type="date" value={f.slot_date} onChange={(e) => setF((s) => ({ ...s, slot_date: e.target.value }))} className="h-9" data-testid="reg-book-date" /></Field>
            <Field label="Slot time *"><Input type="time" value={f.slot_time} onChange={(e) => setF((s) => ({ ...s, slot_time: e.target.value }))} className="h-9" data-testid="reg-book-time" /></Field>
          </div>
          <Field label="Reference no. *"><Input value={f.slot_reference_no} onChange={(e) => setF((s) => ({ ...s, slot_reference_no: e.target.value }))} className="h-9" data-testid="reg-book-ref" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} data-testid="reg-book-submit">Book slot</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExecuteModal({ open, onClose, onSubmit }) {
  const [f, setF] = useState({ executed_date: "", registration_document_number: "", company_representative: "", outcome_notes: "" });
  useEffect(() => { if (open) setF({ executed_date: new Date().toISOString().slice(0, 10), registration_document_number: "", company_representative: "", outcome_notes: "" }); }, [open]);
  const submit = () => {
    if (!f.executed_date || !f.registration_document_number || !f.company_representative) return toast.error("Date, doc number, and representative required");
    onSubmit({
      executed_date: new Date(f.executed_date).toISOString(),
      registration_document_number: f.registration_document_number,
      company_representative: f.company_representative,
      outcome_notes: f.outcome_notes || null,
    });
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent data-testid="reg-execute-modal">
        <DialogHeader><DialogTitle>Mark registration executed</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Executed date *"><Input type="date" value={f.executed_date} onChange={(e) => setF((s) => ({ ...s, executed_date: e.target.value }))} className="h-9" data-testid="reg-exec-date" /></Field>
          <Field label="Registration document # *"><Input value={f.registration_document_number} onChange={(e) => setF((s) => ({ ...s, registration_document_number: e.target.value }))} className="h-9" data-testid="reg-exec-docnum" /></Field>
          <Field label="Company representative *"><Input value={f.company_representative} onChange={(e) => setF((s) => ({ ...s, company_representative: e.target.value }))} className="h-9" data-testid="reg-exec-rep" /></Field>
          <Field label="Outcome notes"><Textarea value={f.outcome_notes} onChange={(e) => setF((s) => ({ ...s, outcome_notes: e.target.value }))} className="min-h-[60px] text-sm" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} data-testid="reg-exec-submit">Mark executed</Button>
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
