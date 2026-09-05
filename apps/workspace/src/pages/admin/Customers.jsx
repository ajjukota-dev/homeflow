import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X as XIcon } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NRI_STATUSES = ["Resident", "NRI", "OCI"];
const COMM_PREFS = ["Email", "Phone", "WhatsApp"];
const KYC_STATUSES = ["Pending", "Received", "Verified", "Rejected"];
const MAX_APPLICANTS = 4;

const emptyApplicant = () => ({
  name: "",
  relation: "",
  email: "",
  phone: "",
  pan: "",
  kyc_status: "Pending",
});

const emptyForm = () => ({
  primary_name: "",
  email: "",
  phone: "",
  nri_status: "Resident",
  communication_pref: "Email",
  address_line: "",
  city: "",
  state: "",
  pincode: "",
  applicants: [emptyApplicant()],
});

export default function AdminCustomers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/customers");
      setRows(r.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      primary_name: c.primary_name || "",
      email: c.email || "",
      phone: c.phone || "",
      nri_status: c.nri_status || "Resident",
      communication_pref: c.communication_pref || "Email",
      address_line: c.address_line || "",
      city: c.city || "",
      state: c.state || "",
      pincode: c.pincode || "",
      applicants: (c.applicants && c.applicants.length ? c.applicants : [emptyApplicant()]).map((a) => ({
        name: a.name || "",
        relation: a.relation || "",
        email: a.email || "",
        phone: a.phone || "",
        pan: a.pan || "",
        kyc_status: a.kyc_status || "Pending",
      })),
    });
    setOpen(true);
  };

  const setApplicant = (i, patch) => {
    const next = form.applicants.slice();
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, applicants: next });
  };

  const addApplicant = () => {
    if (form.applicants.length >= MAX_APPLICANTS) {
      toast.error(`Maximum ${MAX_APPLICANTS} applicants (primary + 3 co-applicants).`);
      return;
    }
    setForm({ ...form, applicants: [...form.applicants, emptyApplicant()] });
  };

  const removeApplicant = (i) => {
    if (form.applicants.length === 1) {
      toast.error("At least one applicant is required.");
      return;
    }
    const next = form.applicants.slice();
    next.splice(i, 1);
    setForm({ ...form, applicants: next });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        primary_name: form.primary_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        nri_status: form.nri_status,
        communication_pref: form.communication_pref,
        address_line: form.address_line.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
        applicants: form.applicants.map((a) => ({
          name: a.name.trim(),
          relation: a.relation.trim() || null,
          email: a.email.trim() || null,
          phone: a.phone.trim() || null,
          pan: a.pan.trim() || null,
          kyc_status: a.kyc_status,
        })),
      };
      if (editing) {
        await api.put(`/customers/${editing.id}`, body);
        toast.success("Customer updated");
      } else {
        await api.post("/customers", body);
        toast.success("Customer created");
      }
      setOpen(false);
      refresh();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  const del = async (c) => {
    if (!window.confirm(`Delete customer ${c.code}? This cannot be undone.`)) return;
    try {
      await api.delete(`/customers/${c.id}`);
      toast.success("Customer deleted");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-customers">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} customer{rows.length === 1 ? "" : "s"}</div>
        <Button onClick={openCreate} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="customers-new">
          <Plus className="h-4 w-4" /> New customer
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Primary</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Contact</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">City / State</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">NRI</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Applicants</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">No customers.</TableCell></TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id} className="h-10" data-testid={`customer-row-${c.code}`}>
                  <TableCell className="px-3 font-mono text-xs text-gray-700">{c.code}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-900 font-medium">{c.primary_name}</TableCell>
                  <TableCell className="px-3 text-xs text-gray-600">
                    <div>{c.email || "—"}</div>
                    <div>{c.phone || "—"}</div>
                  </TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell className="px-3"><StatusPill status={c.nri_status} /></TableCell>
                  <TableCell className="px-3 text-sm text-gray-700 text-right tabular-nums">{(c.applicants || []).length}</TableCell>
                  <TableCell className="px-3 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(c)} data-testid={`customer-edit-${c.code}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700 hover:text-red-800" onClick={() => del(c)} data-testid={`customer-delete-${c.code}`}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="customer-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit customer · ${editing.code}` : "New customer"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            <section className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Primary name</Label>
                <Input value={form.primary_name} onChange={(e) => setForm({ ...form, primary_name: e.target.value })} required data-testid="customer-form-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="customer-form-email" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="customer-form-phone" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">NRI status</Label>
                <Select value={form.nri_status} onValueChange={(v) => setForm({ ...form, nri_status: v })}>
                  <SelectTrigger data-testid="customer-form-nri"><SelectValue /></SelectTrigger>
                  <SelectContent>{NRI_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Communication</Label>
                <Select value={form.communication_pref} onValueChange={(v) => setForm({ ...form, communication_pref: v })}>
                  <SelectTrigger data-testid="customer-form-comm"><SelectValue /></SelectTrigger>
                  <SelectContent>{COMM_PREFS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Address</Label>
                <Input value={form.address_line} onChange={(e) => setForm({ ...form, address_line: e.target.value })} data-testid="customer-form-address" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="customer-form-city" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">State</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="customer-form-state" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pincode</Label>
                <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} data-testid="customer-form-pincode" />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">Applicants <span className="text-xs text-gray-500 font-normal">({form.applicants.length}/{MAX_APPLICANTS})</span></div>
                <Button type="button" size="sm" variant="secondary" className="h-8" onClick={addApplicant} data-testid="customer-add-applicant">
                  <Plus className="h-3.5 w-3.5" /> Add applicant
                </Button>
              </div>
              {form.applicants.map((a, i) => (
                <div key={i} className="rounded-md border border-gray-200 p-3 space-y-3" data-testid={`applicant-row-${i}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-gray-700">
                      {i === 0 ? "Primary applicant" : `Co-applicant ${i}`}
                    </div>
                    {form.applicants.length > 1 && (
                      <button type="button" onClick={() => removeApplicant(i)} className="text-xs text-red-700 hover:underline flex items-center gap-1" data-testid={`applicant-remove-${i}`}>
                        <XIcon className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Name</Label>
                      <Input value={a.name} onChange={(e) => setApplicant(i, { name: e.target.value })} required data-testid={`applicant-name-${i}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Relation</Label>
                      <Input value={a.relation} onChange={(e) => setApplicant(i, { relation: e.target.value })} placeholder="Self / Spouse / Parent" data-testid={`applicant-relation-${i}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Email</Label>
                      <Input value={a.email} onChange={(e) => setApplicant(i, { email: e.target.value })} data-testid={`applicant-email-${i}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Phone</Label>
                      <Input value={a.phone} onChange={(e) => setApplicant(i, { phone: e.target.value })} data-testid={`applicant-phone-${i}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">PAN</Label>
                      <Input value={a.pan} onChange={(e) => setApplicant(i, { pan: e.target.value.toUpperCase() })} data-testid={`applicant-pan-${i}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">KYC status</Label>
                      <Select value={a.kyc_status} onValueChange={(v) => setApplicant(i, { kyc_status: v })}>
                        <SelectTrigger data-testid={`applicant-kyc-${i}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{KYC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="customer-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
