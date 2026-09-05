import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRightCircle } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import PageHeader from "@/components/PageHeader";
import { formatDate, formatINR } from "@/lib/format";
import { BOOKING_TRANSITIONS } from "@/lib/constants";
import RestrictedField from "@/components/rbac/RestrictedField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [booking, setBooking] = useState(null);
  const [project, setProject] = useState(null);
  const [unit, setUnit] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const b = await api.get(`/bookings/${id}`);
      setBooking(b.data);
      const [p, u, c] = await Promise.all([
        api.get(`/projects/${b.data.project_id}`),
        api.get(`/units/${b.data.unit_id}`),
        api.get(`/customers/${b.data.customer_id}`),
      ]);
      setProject(p.data);
      setUnit(u.data);
      setCustomer(c.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="text-sm text-gray-500">Loading booking…</div>;
  if (!booking) return <div className="text-sm text-gray-500">Booking not found.</div>;

  const options = BOOKING_TRANSITIONS[booking.status] || [];
  const canTransition = isSuperAdmin(user) && options.length > 0;

  const openTransition = () => {
    setTarget(options[0] || "");
    setReason("");
    setTransitionOpen(true);
  };

  const doTransition = async (e) => {
    e.preventDefault();
    if (target === "Cancelled" && !reason.trim()) {
      toast.error("Cancellation reason is required.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/bookings/${id}/transition`, { to_status: target, reason: reason || null });
      toast.success(`Moved to ${target}`);
      setTransitionOpen(false);
      refresh();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6" data-testid="booking-detail-page">
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center gap-2 text-xs">
          <Link to="/admin/bookings" className="text-gray-500 hover:text-navy-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Bookings
          </Link>
        </div>

        <PageHeader
          title={<span className="flex items-center gap-3">Booking {booking.code} <StatusPill status={booking.status} /></span>}
          subtitle={<span className="text-xs">Created {formatDate(booking.created_at)} · Booking date {formatDate(booking.booking_date)}</span>}
          actions={
            canTransition && (
              <Button onClick={openTransition} className="h-8 bg-brand-500 hover:bg-brand-600 text-white" data-testid="booking-detail-transition">
                <ArrowRightCircle className="h-4 w-4" /> Transition
              </Button>
            )
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PanelCard
            label="Customer"
            title={customer?.primary_name}
            sub={customer?.code}
            href={customer ? `/customers/${customer.id}` : null}
            testId="booking-detail-customer"
          />
          <PanelCard
            label="Project"
            title={project?.name}
            sub={project ? `${project.type} · ${project.location}` : ""}
            href={project ? `/projects/${project.id}` : null}
          />
          <PanelCard
            label="Unit"
            title={unit ? `Unit ${unit.code}` : "—"}
            sub={unit ? `${[unit.tower, unit.floor, unit.unit_no].filter(Boolean).join(" · ")} · ${unit.unit_type || ""}` : ""}
            href={unit ? `/units/${unit.id}` : null}
          />
        </div>

        <div className="rounded-md border border-gray-200 bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Agreement value" value={<RestrictedField value={booking.agreement_value_inr} module="customer_financials" format="inr" testId="booking-agreement-value" />} className="text-lg font-semibold font-heading" />
          <KV label="Booking amount" value={<RestrictedField value={booking.booking_amount_inr} module="customer_financials" format="inr" testId="booking-booking-amount" />} className="text-lg font-semibold font-heading" />
          <KV label="Sales owner" value={booking.sales_owner_id ? booking.sales_owner_id.slice(0, 8) : "—"} />
          <KV label="CRM owner" value={booking.crm_owner_id ? booking.crm_owner_id.slice(0, 8) : "—"} />
        </div>

        {booking.payment_plan && (
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold mb-1">Payment plan</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{booking.payment_plan}</div>
          </div>
        )}

        {booking.notes && (
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold mb-1">Notes</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{booking.notes}</div>
          </div>
        )}

        {booking.status === "Cancelled" && booking.cancellation_reason && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-red-800 mb-1">Cancellation reason</div>
            <div className="text-sm text-red-900 whitespace-pre-wrap">{booking.cancellation_reason}</div>
          </div>
        )}
      </div>

      <CollaborationPanel entityType="booking" entityId={id} entityTitle={`Booking ${booking.code}`} />

      <Dialog open={transitionOpen} onOpenChange={setTransitionOpen}>
        <DialogContent className="max-w-md" data-testid="booking-detail-transition-dialog">
          <DialogHeader>
            <DialogTitle>Transition {booking.code}</DialogTitle>
            <DialogDescription>Current status: <span className="font-medium">{booking.status}</span></DialogDescription>
          </DialogHeader>
          <form onSubmit={doTransition} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Move to</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger data-testid="booking-detail-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {target === "Cancelled" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Cancellation reason <span className="text-red-600">*</span></Label>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="booking-detail-reason" />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setTransitionOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} className={target === "Cancelled" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-brand-500 hover:bg-brand-600 text-white"} data-testid="booking-detail-transition-submit">
                {busy ? "Working…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PanelCard({ label, title, sub, href, testId }) {
  const inner = (
    <div className="rounded-md border border-gray-200 bg-white p-3 hover:border-brand-300 transition-colors" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
      <div className="text-sm font-medium text-gray-900 mt-1 truncate" title={title}>{title || "—"}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}

function KV({ label, value, className = "" }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{label}</div>
      <div className={["text-gray-900 mt-0.5", className].join(" ")}>{value}</div>
    </div>
  );
}
