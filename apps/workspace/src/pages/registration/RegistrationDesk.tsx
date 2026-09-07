import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, Badge, EmptyState, Skeleton } from "@homeflow/ui";
import { Landmark } from "lucide-react";
import { documentsApi, type BookingPickerRow } from "../documents/api";
import { registrationApi, type RegCase } from "./api";
import { STATUS_META, STATUS_ORDER, CONFIDENCE_META } from "./labels";
import { CaseDrawer } from "./CaseDrawer";

// 23-registration.md Screens: "Registration (Registration role) — pipeline table by status with
// forecast dates." registration_case rows carry no unit_number/booking_number/customer_name join
// (registration/store.ts's REG_SELECT) — labels are resolved here from documentsApi.bookings(),
// the same picker LEGAL already reuses for the Document Factory (permission matrix: REGISTRATION
// has READ on "documents", confirmed in seed/permissions.ts).
//
// listRegistrationPipeline only returns bookings that already have a registration_case row
// (core.ts's own gap, flagged in the spec's Build note) — a booking never yet opened won't appear,
// so this screen also lists every other booking as "not started" to bootstrap a case on first open.
export function RegistrationDesk({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [bookings, setBookings] = useState<BookingPickerRow[] | null>(null);
  const [pipeline, setPipeline] = useState<RegCase[] | null>(null);
  const [error, setError] = useState(false);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    Promise.all([documentsApi.bookings(projectId), registrationApi.pipeline(projectId)])
      .then(([b, p]) => { setBookings(b); setPipeline(p); })
      .catch(() => setError(true));
  }, [projectId]);

  useEffect(load, [load]);

  const labelFor = useMemo(() => {
    const map = new Map<string, BookingPickerRow>();
    for (const b of bookings ?? []) map.set(b.id, b);
    return map;
  }, [bookings]);

  const started = useMemo(() => new Set((pipeline ?? []).map((c) => c.booking_id)), [pipeline]);
  const notStarted = useMemo(() => (bookings ?? []).filter((b) => !started.has(b.id)), [bookings, started]);

  const rowsByStatus = useMemo(() => {
    const map = new Map<string, RegCase[]>();
    for (const c of pipeline ?? []) {
      if (!map.has(c.status)) map.set(c.status, []);
      map.get(c.status)!.push(c);
    }
    return map;
  }, [pipeline]);

  async function start(bookingId: string) {
    try {
      await registrationApi.get(bookingId); // lazy-creates the case row
      setOpenBookingId(bookingId);
      load();
    } catch {
      setError(true);
    }
  }

  const loading = bookings === null || pipeline === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-large font-bold">Registration</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Readiness, SRO scheduling and execution for every booking's sale deed registration.
        </p>
      </div>

      {error && <EmptyState icon={Landmark} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />}

      {!error && loading && (
        <div className="flex flex-col gap-2"><Skeleton /><Skeleton /><Skeleton /></div>
      )}

      {!error && !loading && (pipeline ?? []).length === 0 && notStarted.length === 0 && (
        <EmptyState icon={Landmark} message="No bookings in this project yet." />
      )}

      {!error && !loading && (pipeline ?? []).length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-footnote">
            <thead className="bg-surface-2">
              <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                <th className="p-3 text-left">Unit</th>
                <th className="p-3 text-left">Customer</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Forecast date</th>
                <th className="p-3 text-left">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_ORDER.filter((s) => (rowsByStatus.get(s)?.length ?? 0) > 0).flatMap((status) =>
                rowsByStatus.get(status)!.map((c) => {
                  const b = labelFor.get(c.booking_id);
                  const meta = STATUS_META[c.status];
                  const Icon = meta.icon;
                  return (
                    <tr key={c.id} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setOpenBookingId(c.booking_id)}>
                      {/* Fallback to the case's own code, never the raw booking_id, if the booking
                          picker doesn't carry this booking (e.g. a unit-less orphaned fixture). */}
                      <td className="p-3 font-semibold text-fg">{b?.unit_number ?? c.code}</td>
                      <td className="p-3 text-fg-muted">{b?.applicant_name ?? "—"}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-medium ${meta.className}`}>
                          <Icon className="size-3.5" aria-hidden />
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-3 text-fg-muted">{c.forecast_date ?? "—"}</td>
                      <td className="p-3">
                        {c.forecast_confidence && (
                          <Badge className={CONFIDENCE_META[c.forecast_confidence].className}>{CONFIDENCE_META[c.forecast_confidence].label}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {!error && !loading && notStarted.length > 0 && (
        <div>
          <h2 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Not started</h2>
          <Card>
            <CardBody className="flex flex-col gap-1">
              {notStarted.map((b) => (
                <button key={b.id} onClick={() => start(b.id)} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-footnote hover:bg-surface-2">
                  <span>{b.unit_number} · {b.applicant_name ?? "—"}</span>
                  <span className="text-caption font-medium text-accent">Open registration</span>
                </button>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      <CaseDrawer bookingId={openBookingId} roles={roles} onClose={() => setOpenBookingId(null)} onChanged={load} />
    </div>
  );
}
