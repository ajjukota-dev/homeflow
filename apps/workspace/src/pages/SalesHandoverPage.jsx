import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  Undo2,
  Save,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import CanAccess from "@/components/rbac/CanAccess";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { HANDOVER_STATUS_TONE, DOC_STATUS_TONE } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const COMMITMENT_CATEGORIES = [
  "Modification", "Commercial Promise", "Timeline Promise",
  "Complimentary Item", "Specification Upgrade", "Other",
];

export default function SalesHandoverPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [handover, setHandover] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [uploadingCategory, setUploadingCategory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await api.get(`/sales-handovers/booking/${bookingId}`);
      setHandover(h.data);
      const c = await api.get(`/customers/${h.data.customer_id}`);
      setCustomer(c.data);
      const docs = await api.get(`/documents`, { params: { customer_id: h.data.customer_id, booking_id: bookingId } });
      setDocuments(docs.data || []);
      setDirty(false);
      setErrors({});
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-gray-500">Loading handover…</div>;
  if (!handover) return <div className="text-sm text-gray-500">Handover not found.</div>;

  const isSalesOwner = handover._booking?.sales_owner_id === user?.id;
  const isCRMUser = user?.role?.code === "CRM";
  const canEdit = (isSalesOwner || isSuperAdmin(user)) && (handover.status === "Draft" || handover.status === "Returned");
  const canSubmit = canEdit;
  const canAcceptOrReturn = (isCRMUser || isSuperAdmin(user)) && handover.status === "Submitted" && handover.submitted_by !== user?.id;

  const updateSection = (section, patch) => {
    setHandover((h) => ({ ...h, [section]: { ...h[section], ...patch } }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        customer_section: handover.customer_section,
        commercial_section: handover.commercial_section,
        unit_section: handover.unit_section,
        documents_section: handover.documents_section,
        commitments_section: handover.commitments_section,
      };
      const r = await api.patch(`/sales-handovers/${handover.id}`, payload);
      setHandover(r.data);
      setDirty(false);
      toast.success("Draft saved");
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (dirty) await save();
    setSaving(true);
    try {
      const r = await api.post(`/sales-handovers/${handover.id}/submit`);
      setHandover(r.data);
      toast.success("Submitted to CRM");
      setErrors({});
    } catch (e) {
      const errDetail = e?.response?.data?.detail;
      if (errDetail?.errors) {
        setErrors(errDetail.errors);
        toast.error(errDetail.message || "Validation failed");
      } else {
        apiErrorToast(e);
      }
    } finally {
      setSaving(false);
    }
  };

  const accept = async () => {
    setSaving(true);
    try {
      const r = await api.post(`/sales-handovers/${handover.id}/accept`);
      setHandover(r.data);
      toast.success("Handover accepted");
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const doReturn = async () => {
    if (!returnReason.trim()) return;
    setSaving(true);
    try {
      const r = await api.post(`/sales-handovers/${handover.id}/return`, { reason: returnReason.trim() });
      setHandover(r.data);
      toast.success("Returned to Sales for clarification");
      setReturnOpen(false);
      setReturnReason("");
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const uploadDoc = async (docId, file) => {
    if (!file) return;
    setUploadingCategory(docId);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post(`/documents/${docId}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setDocuments((docs) => docs.map((d) => (d.id === docId ? r.data.document : d)));
      toast.success(`Uploaded ${file.name}`);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setUploadingCategory(null);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6" data-testid="sales-handover-page">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center gap-2 text-xs">
          <Link to="/sales-handover" className="text-gray-500 hover:text-navy-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> All handovers
          </Link>
        </div>
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title={`Sales Handover — ${handover._booking?.code}`}
            subtitle={<span><span className="font-mono">{handover._customer?.code}</span> · {handover._customer?.primary_name} · {handover._project?.name} · <span className="font-mono">{handover._unit?.code}</span></span>}
          />
          <div className="flex items-center gap-2 shrink-0">
            <StatusPill status={handover.status} tone={HANDOVER_STATUS_TONE[handover.status]} testId="handover-status-badge" />
            <CanAccess module="sales_handover" action="write">
              {canEdit && dirty && (
                <Button size="sm" variant="outline" onClick={save} disabled={saving} data-testid="handover-save">
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save draft"}
                </Button>
              )}
              {canSubmit && (
                <Button size="sm" onClick={submit} disabled={saving} data-testid="handover-submit">
                  <Send className="h-3.5 w-3.5" /> Submit to CRM
                </Button>
              )}
              {canAcceptOrReturn && (
                <>
                  <Button size="sm" onClick={accept} disabled={saving} data-testid="handover-accept">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)} disabled={saving} data-testid="handover-return">
                    <Undo2 className="h-3.5 w-3.5" /> Return for clarification
                  </Button>
                </>
              )}
            </CanAccess>
            {!canAcceptOrReturn && handover.status === "Submitted" && (
              <span className="text-xs text-gray-500" data-testid="handover-awaiting-crm">Awaiting CRM acceptance</span>
            )}
          </div>
        </div>

        {handover.status === "Returned" && handover.return_reason && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2 text-amber-900" data-testid="handover-returned-banner">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold">Returned by CRM</div>
              <div className="mt-0.5">{handover.return_reason}</div>
            </div>
          </div>
        )}
        {Object.keys(errors).length > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800" data-testid="handover-errors">
            <div className="text-xs font-semibold">Please address the following before submitting:</div>
            <ul className="mt-1 text-[11px] list-disc pl-5">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k}><span className="font-mono">{k}</span>: {v}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 1. Customer */}
        <Card title="Customer" testId="card-customer">
          <ReadRow k="Primary name" v={customer?.primary_name} />
          <ReadRow k="Email" v={customer?.email} />
          <ReadRow k="Phone" v={customer?.phone} />
          <ReadRow k="NRI status" v={customer?.nri_status} />
          <ReadRow k="Communication" v={customer?.communication_pref} />
          <div className="col-span-full grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
            <BoolField label="Applicant details confirmed" value={handover.customer_section?.applicant_details_confirmed} onChange={(v) => updateSection("customer_section", { applicant_details_confirmed: v })} disabled={!canEdit} testId="cs-applicant" />
            <BoolField label="Contact verified" value={handover.customer_section?.contact_verified} onChange={(v) => updateSection("customer_section", { contact_verified: v })} disabled={!canEdit} testId="cs-contact" />
            <BoolField label="NRI status confirmed" value={handover.customer_section?.nri_status_confirmed} onChange={(v) => updateSection("customer_section", { nri_status_confirmed: v })} disabled={!canEdit} testId="cs-nri" />
            <BoolField label="Communication pref confirmed" value={handover.customer_section?.communication_pref_confirmed} onChange={(v) => updateSection("customer_section", { communication_pref_confirmed: v })} disabled={!canEdit} testId="cs-comm" />
          </div>
          <div className="col-span-full">
            <label className="text-[11px] text-gray-500">Notes</label>
            <Textarea value={handover.customer_section?.notes || ""} onChange={(e) => updateSection("customer_section", { notes: e.target.value })} disabled={!canEdit} className="text-xs min-h-[60px]" data-testid="cs-notes" />
          </div>
        </Card>

        {/* 2. Commercial */}
        <Card title="Commercial" testId="card-commercial">
          <NumField label="Final price (INR)" value={handover.commercial_section?.final_price_inr} onChange={(v) => updateSection("commercial_section", { final_price_inr: v })} disabled={!canEdit} testId="com-price" />
          <NumField label="Discount (INR)" value={handover.commercial_section?.discount_inr} onChange={(v) => updateSection("commercial_section", { discount_inr: v })} disabled={!canEdit} testId="com-discount" />
          <NumField label="Booking amount (INR)" value={handover.commercial_section?.booking_amount_inr} onChange={(v) => updateSection("commercial_section", { booking_amount_inr: v })} disabled={!canEdit} testId="com-booking" />
          <TextField label="Payment plan reference" value={handover.commercial_section?.payment_plan_ref} onChange={(v) => updateSection("commercial_section", { payment_plan_ref: v })} disabled={!canEdit} testId="com-plan" />
          <NumField label="Brokerage %" value={handover.commercial_section?.brokerage_percent} onChange={(v) => updateSection("commercial_section", { brokerage_percent: v })} disabled={!canEdit} testId="com-brokerage-pct" />
          <NumField label="Brokerage (INR)" value={handover.commercial_section?.brokerage_inr} onChange={(v) => updateSection("commercial_section", { brokerage_inr: v })} disabled={!canEdit} testId="com-brokerage-inr" />
          <TextField label="Taxes summary" value={handover.commercial_section?.taxes_summary} onChange={(v) => updateSection("commercial_section", { taxes_summary: v })} disabled={!canEdit} testId="com-taxes" full />
          <div className="col-span-full">
            <label className="text-[11px] text-gray-500">Notes</label>
            <Textarea value={handover.commercial_section?.notes || ""} onChange={(e) => updateSection("commercial_section", { notes: e.target.value })} disabled={!canEdit} className="text-xs min-h-[50px]" data-testid="com-notes" />
          </div>
          <DeviationsEditor value={handover.commercial_section?.approved_deviations || []} onChange={(v) => updateSection("commercial_section", { approved_deviations: v })} disabled={!canEdit} />
        </Card>

        {/* 3. Unit */}
        <Card title="Unit" testId="card-unit">
          <ReadRow k="Project" v={handover._project?.name} />
          <ReadRow k="Unit code" v={handover._unit?.code} />
          <ReadRow k="Type" v={handover._unit?.unit_type} />
          <ReadRow k="Carpet area (sqft)" v={handover._unit?.carpet_area_sqft} />
          <BoolField label="Unit confirmed" value={handover.unit_section?.unit_confirmed} onChange={(v) => updateSection("unit_section", { unit_confirmed: v })} disabled={!canEdit} testId="us-unit" />
          <NumField label="Parking count" value={handover.unit_section?.parking_count} onChange={(v) => updateSection("unit_section", { parking_count: v })} disabled={!canEdit} testId="us-parking" />
          <BoolField label="Facing confirmed" value={handover.unit_section?.facing_confirmed} onChange={(v) => updateSection("unit_section", { facing_confirmed: v })} disabled={!canEdit} testId="us-facing" />
          <div className="col-span-full">
            <label className="text-[11px] text-gray-500">Specifications notes</label>
            <Textarea value={handover.unit_section?.specifications_notes || ""} onChange={(e) => updateSection("unit_section", { specifications_notes: e.target.value })} disabled={!canEdit} className="text-xs min-h-[50px]" data-testid="us-notes" />
          </div>
        </Card>

        {/* 4. Documents */}
        <Card title="Documents" testId="card-documents">
          <div className="col-span-full rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
            {documents.length === 0 && (
              <div className="p-3 text-xs text-gray-500">No documents yet — checklist should have been auto-seeded on journey creation.</div>
            )}
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 gap-3" data-testid={`doc-row-${d.category.replace(/\s+/g,'-')}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 flex items-center gap-2">
                    {d.category}
                    {d.required && d.applicable !== false && (
                      <span className="text-[10px] text-red-600 font-medium">Required</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500">{d.title} {d.latest_version > 0 && `· v${d.latest_version}`}</div>
                </div>
                <StatusPill status={d.status} tone={DOC_STATUS_TONE[d.status]} />
                <label className="cursor-pointer">
                  <span className={["text-xs px-2 py-1 rounded border", canEdit && d.applicable !== false ? "border-gray-300 hover:bg-gray-50" : "border-gray-200 text-gray-400 cursor-not-allowed"].join(" ")}>
                    {uploadingCategory === d.id ? <Loader2 className="h-3 w-3 inline animate-spin" /> : (d.latest_version > 0 ? "Upload new version" : "Upload")}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={!canEdit || d.applicable === false || uploadingCategory === d.id}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadDoc(d.id, f); }}
                    data-testid={`doc-upload-${d.category.replace(/\s+/g,'-')}`}
                  />
                </label>
              </div>
            ))}
          </div>
        </Card>

        {/* 5. Commitments */}
        <Card title="Commitments" testId="card-commitments">
          <CommitmentsEditor
            value={handover.commitments_section?.items || []}
            onChange={(items) => updateSection("commitments_section", { items })}
            disabled={!canEdit}
          />
        </Card>
      </div>

      <CollaborationPanel entityType="sales_handover" entityId={handover.id} entityTitle={`Handover for ${handover._booking?.code}`} />

      {/* Return dialog */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent data-testid="handover-return-dialog">
          <DialogHeader>
            <DialogTitle>Return for clarification</DialogTitle>
            <DialogDescription>The Sales owner will be notified with your reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-[11px] text-gray-500">Reason *</label>
            <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="min-h-[100px] text-sm" data-testid="handover-return-reason" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button onClick={doReturn} disabled={!returnReason.trim() || saving} data-testid="handover-return-submit">Return handover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ title, children, testId }) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-4" data-testid={testId}>
      <h3 className="font-heading text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}
function ReadRow({ k, v }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 tracking-wide">{k}</div>
      <div className="text-sm text-gray-900 mt-0.5 truncate">{v ?? "—"}</div>
    </div>
  );
}
function BoolField({ label, value, onChange, disabled, testId }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <Checkbox checked={!!value} onCheckedChange={(v) => onChange(!!v)} disabled={disabled} data-testid={testId} />
      <span className="text-xs text-gray-800 leading-tight">{label}</span>
    </label>
  );
}
function NumField({ label, value, onChange, disabled, testId }) {
  return (
    <div>
      <label className="text-[11px] text-gray-500">{label}</label>
      <Input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} disabled={disabled} className="h-8 text-sm" data-testid={testId} />
    </div>
  );
}
function TextField({ label, value, onChange, disabled, testId, full }) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <label className="text-[11px] text-gray-500">{label}</label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 text-sm" data-testid={testId} />
    </div>
  );
}
function DeviationsEditor({ value, onChange, disabled }) {
  const rows = value || [];
  return (
    <div className="col-span-full">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] text-gray-500">Approved deviations</label>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange([...rows, { code: "", description: "", approved_by: "", approved_at: "" }])} data-testid="deviations-add">+ Add</Button>
        )}
      </div>
      <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.length === 0 && <div className="p-3 text-xs text-gray-500">No deviations recorded.</div>}
        {rows.map((r, i) => (
          <div key={i} className="p-2 grid grid-cols-2 md:grid-cols-4 gap-2" data-testid={`deviation-row-${i}`}>
            <Input placeholder="Code" value={r.code} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} disabled={disabled} className="h-7 text-xs" />
            <Input placeholder="Description" value={r.description} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} disabled={disabled} className="h-7 text-xs md:col-span-2" />
            <Input placeholder="Approved by" value={r.approved_by} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, approved_by: e.target.value } : x))} disabled={disabled} className="h-7 text-xs" />
            {!disabled && (
              <button className="text-[11px] text-red-600 hover:underline text-left col-span-full" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function CommitmentsEditor({ value, onChange, disabled }) {
  const rows = value || [];
  return (
    <div className="col-span-full">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] text-gray-500">Commitments captured during handover (promoted on submit)</label>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange([...rows, { category: "Other", description: "", target_date: "", financial_impact_inr: null, needs_approval: false }])} data-testid="commitments-add">+ Add commitment</Button>
        )}
      </div>
      <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.length === 0 && <div className="p-3 text-xs text-gray-500">No commitments recorded.</div>}
        {rows.map((r, i) => (
          <div key={i} className="p-2 space-y-2" data-testid={`commit-row-${i}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Select value={r.category} onValueChange={(v) => onChange(rows.map((x, j) => j === i ? { ...x, category: v } : x))} disabled={disabled}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {COMMITMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Target date (YYYY-MM-DD)" value={r.target_date || ""} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, target_date: e.target.value } : x))} disabled={disabled} className="h-8 text-xs" />
              <Input type="number" placeholder="Financial impact (₹)" value={r.financial_impact_inr ?? ""} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, financial_impact_inr: e.target.value === "" ? null : Number(e.target.value) } : x))} disabled={disabled} className="h-8 text-xs" />
            </div>
            <Textarea placeholder="Description of the commitment" value={r.description || ""} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} disabled={disabled} className="text-xs min-h-[50px]" />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!r.needs_approval} onCheckedChange={(v) => onChange(rows.map((x, j) => j === i ? { ...x, needs_approval: !!v } : x))} disabled={disabled} />
                <span className="text-xs">Needs approval</span>
              </label>
              {!disabled && (
                <button className="text-[11px] text-red-600 hover:underline" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
