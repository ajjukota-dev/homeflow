import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ArrowRightCircle } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { formatDate, formatINR, todayIsoDate } from "@/lib/format";
import { BOOKING_TRANSITIONS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const emptyForm = () => ({
  project_id: "",
  unit_id: "",
  customer_id: "",
  sales_owner_id: "",
  crm_owner_id: "",
  booking_date: todayIsoDate(),
  agreement_value_inr: "",
  booking_amount_inr: "",
  payment_plan: "",
  notes: "",
});

export default function AdminBookings() {
  const [bookings, setBookings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [units, setUnits] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionBooking, setTransitionBooking] = useState(null);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [transitioning, setTransitioning] = useState(false);

  const refreshAll = async () => {
    setLoading(true);
    try {
      const [bRes, pRes, uRes, cRes, usersRes] = await Promise.all([
        api.get("/bookings"),
        api.get("/projects"),
        api.get("/units"),
        api.get("/customers"),
        api.get("/users/assignable"),
      ]);
      setBookings(bRes.data);
      setProjects(pRes.data);
      setUnits(uRes.data);
      setCustomers(cRes.data);
      setUsers(usersRes.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const unitById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const availableUnitsForProject = useMemo(() => {
    if (!form.project_id) return [];
    const currentUnitId = editing?.unit_id;
    return units.filter(
      (u) => u.project_id === form.project_id && (u.status === "Available" || u.id === currentUnitId)
    );
  }, [units, form.project_id, editing]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      project_id: b.project_id,
      unit_id: b.unit_id,
      customer_id: b.customer_id,
      sales_owner_id: b.sales_owner_id,
      crm_owner_id: b.crm_owner_id || "",
      booking_date: (b.booking_date || "").slice(0, 10),
      agreement_value_inr: String(b.agreement_value_inr ?? ""),
      booking_amount_inr: String(b.booking_amount_inr ?? ""),
      payment_plan: b.payment_plan || "",
      notes: b.notes || "",
    });
    setOpen(true);
  };

  const onUnitChange = (unitId) => {
    const u = unitById[unitId];
    setForm((f) => ({
      ...f,
      unit_id: unitId,
      agreement_value_inr: u && !f.agreement_value_inr ? String(u.base_price_inr) : f.agreement_value_inr,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const body = {
          sales_owner_id: form.sales_owner_id,
          crm_owner_id: form.crm_owner_id || null,
          booking_date: form.booking_date,
          agreement_value_inr: Number(form.agreement_value_inr),
          booking_amount_inr: Number(form.booking_amount_inr),
          payment_plan: form.payment_plan || null,
          notes: form.notes || null,
        };
        await api.put(`/bookings/${editing.id}`, body);
        toast.success("Booking updated");
      } else {
        const body = {
          project_id: form.project_id,
          unit_id: form.unit_id,
          customer_id: form.customer_id,
          sales_owner_id: form.sales_owner_id,
          crm_owner_id: form.crm_owner_id || null,
          booking_date: form.booking_date,
          agreement_value_inr: Number(form.agreement_value_inr),
          booking_amount_inr: Number(form.booking_amount_inr),
          payment_plan: form.payment_plan || null,
          notes: form.notes || null,
        };
        await api.post("/bookings", body);
        toast.success("Booking created (Draft)");
      }
      setOpen(false);
      refreshAll();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  const openTransition = (b) => {
    setTransitionBooking(b);
    const options = BOOKING_TRANSITIONS[b.status] || [];
    setTransitionTarget(options[0] || "");
    setTransitionReason("");
    setTransitionOpen(true);
  };

  const doTransition = async (e) => {
    e.preventDefault();
    if (!transitionTarget) return;
    if (transitionTarget === "Cancelled" && !transitionReason.trim()) {
      toast.error("Cancellation reason is required.");
      return;
    }
    setTransitioning(true);
    try {
      await api.post(`/bookings/${transitionBooking.id}/transition`, {
        to_status: transitionTarget,
        reason: transitionReason.trim() || null,
      });
      toast.success(`Booking ${transitionBooking.code} → ${transitionTarget}`);
      setTransitionOpen(false);
      refreshAll();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-bookings">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</div>
        <Button onClick={openCreate} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="bookings-new">
          <Plus className="h-4 w-4" /> New booking
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Project · Unit</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Customer</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Sales / CRM</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Agreement</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Booking amt</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Date</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : bookings.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-gray-500">No bookings yet.</TableCell></TableRow>
            ) : (
              bookings.map((b) => {
                const canTransition = (BOOKING_TRANSITIONS[b.status] || []).length > 0;
                return (
                  <TableRow key={b.id} className="h-10" data-testid={`booking-row-${b.code}`}>
                    <TableCell className="px-3 font-mono text-xs text-gray-700">{b.code}</TableCell>
                    <TableCell className="px-3 text-sm text-gray-800">
                      <div className="text-sm text-gray-900">{projectById[b.project_id]?.name || "—"}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{unitById[b.unit_id]?.code || "—"}</div>
                    </TableCell>
                    <TableCell className="px-3 text-sm text-gray-800">
                      <div>{customerById[b.customer_id]?.primary_name || "—"}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{customerById[b.customer_id]?.code || ""}</div>
                    </TableCell>
                    <TableCell className="px-3 text-xs text-gray-700">
                      <div>{userById[b.sales_owner_id]?.name || "—"}</div>
                      <div className="text-gray-500">{userById[b.crm_owner_id]?.name || "—"}</div>
                    </TableCell>
                    <TableCell className="px-3 text-sm text-gray-900 text-right tabular-nums">{formatINR(b.agreement_value_inr)}</TableCell>
                    <TableCell className="px-3 text-sm text-gray-700 text-right tabular-nums">{formatINR(b.booking_amount_inr)}</TableCell>
                    <TableCell className="px-3 text-xs text-gray-600">{formatDate(b.booking_date)}</TableCell>
                    <TableCell className="px-3">
                      <div className="space-y-1">
                        <StatusPill status={b.status} />
                        {b.status === "Cancelled" && b.cancellation_reason && (
                          <div className="text-[10px] text-gray-500 max-w-[180px] truncate" title={b.cancellation_reason}>
                            Reason: {b.cancellation_reason}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 text-right">
                      {b.status !== "Cancelled" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(b)} data-testid={`booking-edit-${b.code}`}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                      {canTransition && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-navy-900" onClick={() => openTransition(b)} data-testid={`booking-transition-${b.code}`}>
                          <ArrowRightCircle className="h-3.5 w-3.5" /> Transition
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="booking-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit booking · ${editing.code}` : "New booking"}</DialogTitle>
            {editing && (
              <DialogDescription>Project / Unit / Customer cannot be changed after creation.</DialogDescription>
            )}
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Project</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v, unit_id: "" })} disabled={!!editing}>
                <SelectTrigger data-testid="booking-form-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit</Label>
              <Select value={form.unit_id} onValueChange={onUnitChange} disabled={!form.project_id || !!editing}>
                <SelectTrigger data-testid="booking-form-unit"><SelectValue placeholder={form.project_id ? "Select unit" : "Pick project first"} /></SelectTrigger>
                <SelectContent>
                  {availableUnitsForProject.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.code} — {u.unit_type || "unit"} · {formatINR(u.base_price_inr)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Customer</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })} disabled={!!editing}>
                <SelectTrigger data-testid="booking-form-customer"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.primary_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sales owner</Label>
              <Select value={form.sales_owner_id} onValueChange={(v) => setForm({ ...form, sales_owner_id: v })}>
                <SelectTrigger data-testid="booking-form-sales"><SelectValue placeholder="Select sales owner" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">CRM owner</Label>
              <Select value={form.crm_owner_id || "__none__"} onValueChange={(v) => setForm({ ...form, crm_owner_id: v === "__none__" ? "" : v })}>
                <SelectTrigger data-testid="booking-form-crm"><SelectValue placeholder="Select CRM owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Booking date</Label>
              <Input type="date" value={form.booking_date} onChange={(e) => setForm({ ...form, booking_date: e.target.value })} required data-testid="booking-form-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agreement value (INR)</Label>
              <Input type="number" value={form.agreement_value_inr} onChange={(e) => setForm({ ...form, agreement_value_inr: e.target.value })} required data-testid="booking-form-agreement" />
              <div className="text-[10px] text-gray-500">{formatINR(Number(form.agreement_value_inr) || 0)}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Booking amount (INR)</Label>
              <Input type="number" value={form.booking_amount_inr} onChange={(e) => setForm({ ...form, booking_amount_inr: e.target.value })} required data-testid="booking-form-amount" />
              <div className="text-[10px] text-gray-500">{formatINR(Number(form.booking_amount_inr) || 0)}</div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Payment plan</Label>
              <Textarea rows={2} value={form.payment_plan} onChange={(e) => setForm({ ...form, payment_plan: e.target.value })} placeholder="Free text. Structured plans arrive in Phase 2." data-testid="booking-form-plan" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="booking-form-notes" />
            </div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="booking-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create (Draft)"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transition dialog */}
      <Dialog open={transitionOpen} onOpenChange={setTransitionOpen}>
        <DialogContent className="max-w-md" data-testid="booking-transition-dialog">
          <DialogHeader>
            <DialogTitle>Transition booking {transitionBooking?.code}</DialogTitle>
            <DialogDescription>Current status: <span className="font-medium">{transitionBooking?.status}</span></DialogDescription>
          </DialogHeader>
          <form onSubmit={doTransition} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Move to</Label>
              <Select value={transitionTarget} onValueChange={setTransitionTarget}>
                <SelectTrigger data-testid="booking-transition-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(BOOKING_TRANSITIONS[transitionBooking?.status] || []).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {transitionTarget === "Cancelled" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Cancellation reason <span className="text-red-600">*</span></Label>
                <Textarea rows={3} value={transitionReason} onChange={(e) => setTransitionReason(e.target.value)} required data-testid="booking-transition-reason" />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setTransitionOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={transitioning} className={transitionTarget === "Cancelled" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-brand-500 hover:bg-brand-600 text-white"} data-testid="booking-transition-submit">
                {transitioning ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
