import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Landmark } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import FinancialSnapshot from "@/components/customer/FinancialSnapshot";
import PaymentScheduleCard from "@/components/customer/PaymentScheduleCard";
import TDSCard from "@/components/customer/TDSCard";
import FinancialClearanceCard from "@/components/customer/FinancialClearanceCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Customer 360 Financials tab — spec §45–§48.
 * A customer can have multiple bookings; we surface the snapshot at the top
 * (aggregated over all bookings) and a booking-scoped Schedule + TDS + FC below.
 */
export default function FinancialsTab({ customerId, bookings }) {
  const confirmed = useMemo(
    () => (bookings || []).filter((b) => b.status === "Confirmed"),
    [bookings],
  );

  const [bookingId, setBookingId] = useState(confirmed[0]?.id || null);
  useEffect(() => {
    if (!bookingId && confirmed[0]) setBookingId(confirmed[0].id);
  }, [confirmed, bookingId]);

  const [snapshot, setSnapshot] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [payments, setPayments] = useState([]);
  const [tds, setTds] = useState(null);
  const [fc, setFc] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadSnapshot = async () => {
    try {
      const r = await api.get(`/collections/customer/${customerId}`);
      setSnapshot(r.data);
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const loadBookingScoped = async (bid) => {
    if (!bid) {
      setSchedule(null); setPayments([]); setTds(null); setFc(null);
      return;
    }
    setLoading(true);
    try {
      const [s, p, t, f] = await Promise.all([
        api.get(`/payment-schedules/booking/${bid}`),
        api.get(`/payments`, { params: { booking_id: bid } }),
        api.get(`/tds/booking/${bid}`),
        api.get(`/financial-clearances/booking/${bid}`),
      ]);
      setSchedule(s.data);
      setPayments(p.data || []);
      setTds(t.data);
      setFc(f.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  const reloadAll = async () => {
    await Promise.all([loadSnapshot(), loadBookingScoped(bookingId)]);
  };

  useEffect(() => {
    loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    loadBookingScoped(bookingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (confirmed.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center" data-testid="financials-empty">
        <Landmark className="h-6 w-6 text-gray-300 mx-auto" />
        <div className="mt-2 text-sm text-gray-700">No Confirmed bookings yet.</div>
        <div className="text-xs text-gray-500 mt-1">
          Financial tracking activates when a booking is transitioned Draft → Confirmed.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="financials-tab">
      <FinancialSnapshot snapshot={snapshot} />

      {confirmed.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Booking</span>
          <Select value={bookingId || ""} onValueChange={setBookingId}>
            <SelectTrigger className="h-8 w-72 text-sm" data-testid="financials-booking-select">
              <SelectValue placeholder="Select a booking…" />
            </SelectTrigger>
            <SelectContent>
              {confirmed.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  <span className="font-mono text-xs">{b.code}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <PaymentScheduleCard
        bookingId={bookingId}
        schedule={schedule}
        payments={payments}
        loading={loading}
        onChanged={reloadAll}
      />

      <TDSCard bookingId={bookingId} tds={tds} onChanged={reloadAll} />

      <FinancialClearanceCard bookingId={bookingId} fc={fc} tds={tds} onChanged={reloadAll} />
    </div>
  );
}
