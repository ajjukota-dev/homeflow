// 28-360-views.md rule 2 — Customer 360, replacing the pre-28 version (same {customerId, onBack,
// roles} signature CrmQueue.tsx already calls, kept exactly so that call site needs no change).
// Commitments/Requests are rendered from the overview payload's own inline arrays — the backend
// manifest's own comment on the "requests" tab says why: 18 has no multi-booking listing endpoint,
// so `getCustomer360` already fetched this data once; a second fetch would just repeat it.
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, CircleAlert } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent, EmptyState, Skeleton, Badge, KeyValue } from "@homeflow/ui";
import { threeSixtyApi, type Customer360View } from "./three-sixty/api";
import { TabPanel, TabBadge } from "./three-sixty/TabPanel";
import { ActivityFeed } from "../components/ActivityFeed";
import { Booking360 } from "./booking/Booking360";
import { kycStatusLabel, bookingStatusLabel } from "../lib/labels";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function Customer360({ customerId, onBack, roles }: { customerId: string; onBack: () => void; roles: string[] }) {
  const [view, setView] = useState<Customer360View | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<string | undefined>(undefined);
  const [viewingBookingId, setViewingBookingId] = useState<string | null>(null);

  useEffect(() => {
    setView(undefined);
    setError(false);
    setTab(undefined);
    threeSixtyApi.getCustomer360(customerId).then(setView).catch(() => setError(true));
    threeSixtyApi.setMyContext({ entity_type: "customer", entity_id: customerId }).catch(() => {});
  }, [customerId]);

  if (viewingBookingId) {
    return <Booking360 bookingId={viewingBookingId} roles={roles} onBack={() => setViewingBookingId(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </button>

      {error && <EmptyState icon={CircleAlert} message="Couldn't load this customer." />}
      {!error && view === undefined && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {view && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-title2 font-semibold text-fg-muted">
              {initials(view.display_name)}
            </div>
            <div>
              <h1 className="text-large font-bold">{view.display_name}</h1>
              <p className="text-subhead text-fg-muted">{view.primary_phone ?? view.primary_email ?? "—"}</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ontrack/10 px-3 py-1 text-footnote font-medium text-ontrack">
              <ShieldCheck className="h-3.5 w-3.5" /> KYC {kycStatusLabel(view.kyc_status)}
            </span>
          </div>

          {view.merged_into_customer_id && (
            <div className="rounded-lg border border-atrisk bg-atrisk/10 px-4 py-2 text-footnote text-atrisk">
              This customer record was merged into another customer.
            </div>
          )}

          <Tabs value={tab ?? "profile"} onValueChange={setTab}>
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="profile" className="shrink-0 whitespace-nowrap">Profile</TabsTrigger>
                <TabsTrigger value="bookings" className="shrink-0 whitespace-nowrap">Bookings</TabsTrigger>
                <TabsTrigger value="requests" className="shrink-0 whitespace-nowrap">Requests</TabsTrigger>
                <TabsTrigger value="health" className="shrink-0 whitespace-nowrap">Health</TabsTrigger>
                {view.tabs
                  .filter((t) => t.key !== "requests")
                  .map((t) => (
                    <TabsTrigger key={t.key} value={t.key} className="shrink-0 whitespace-nowrap">
                      {t.label}
                      <TabBadge entry={t} />
                    </TabsTrigger>
                  ))}
              </TabsList>
            </div>

            <TabsContent value="profile">
              <KeyValue
                items={[
                  { key: "Residency", value: view.residency },
                  { key: "Phone", value: view.primary_phone ?? "—" },
                  { key: "Email", value: view.primary_email ?? "—" },
                  { key: "Applicants", value: view.applicants.length === 0 ? "—" : view.applicants.map((a) => `${a.display_name} (${a.role}, ${a.booking_number})`).join(", ") },
                  { key: "Merged from", value: view.merged_from.length === 0 ? "None" : view.merged_from.map((m) => m.display_name).join(", ") },
                ]}
              />
            </TabsContent>

            <TabsContent value="bookings">
              {view.bookings.length === 0 ? (
                <EmptyState message="No bookings yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  {view.bookings.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setViewingBookingId(b.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2"
                    >
                      <div>
                        <div className="text-headline font-semibold">Villa {b.unit_number}</div>
                        <div className="text-footnote text-fg-muted">{b.booking_number}</div>
                      </div>
                      <Badge>{bookingStatusLabel(b.status)}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="requests">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Commitments</h3>
                  {view.commitments.length === 0 ? (
                    <p className="text-footnote text-fg-muted">None recorded.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {view.commitments.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-footnote">
                          <span className="text-fg">{c.title}</span>
                          <Badge>{c.category}</Badge>
                          <span className="ml-auto text-fg-muted">{c.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Change requests</h3>
                  {view.change_requests.length === 0 ? (
                    <p className="text-footnote text-fg-muted">None recorded.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {view.change_requests.map((cr) => (
                        <li key={cr.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-footnote">
                          <span className="text-fg">{cr.title}</span>
                          <span className="ml-auto text-fg-muted">{cr.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="health">
              <div className="rounded-card border border-line bg-surface p-4">
                <p className="text-ws-sm text-fg-muted">Customer Health</p>
                <p className="hf-tnum mt-1 text-ws-xl font-semibold text-fg">{Math.round(view.health.score)}</p>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {view.health.drivers.map((d) => (
                    <li key={d.label} className="flex items-center gap-2 text-ws-sm text-fg-muted">
                      <span className={`size-1.5 rounded-full ${d.delta >= 0 ? "bg-ok" : "bg-danger"}`} aria-hidden />
                      {d.label} ({d.delta >= 0 ? "+" : ""}{d.delta})
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>

            {view.tabs
              .filter((t) => t.key !== "requests")
              .map((t) => (
                <TabsContent key={t.key} value={t.key}>
                  {t.key === "activity" ? <ActivityFeed entityType="customer" entityId={customerId} /> : <TabPanel entry={t} />}
                </TabsContent>
              ))}
          </Tabs>
        </>
      )}
    </div>
  );
}
