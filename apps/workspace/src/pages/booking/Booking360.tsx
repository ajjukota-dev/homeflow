// 28-360-views.md rule 3 — Booking 360. Three tabs embed an already-built, purpose-designed
// component instead of the generic TabPanel: Commitments (a real inline section, no header
// conflict), and Sales handover / Legal & Registration (each opened via its existing Drawer —
// portaled, so it never nests inside this page's own h1/tab layout). Everything else renders
// through the generic reader, per this spec's "content of tabs is owned by their specs" rule.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, ListChecks, FileText, Scale } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent, EmptyState, Skeleton, ScoreCard, Badge, Button } from "@homeflow/ui";
import { threeSixtyApi, type Booking360View, type Score } from "../three-sixty/api";
import { scoreCardProps } from "../three-sixty/format";
import { TabPanel, TabBadge } from "../three-sixty/TabPanel";
import { ActivityFeed } from "../../components/ActivityFeed";
import { Project360Header } from "../../components/Project360Header";
import { Breadcrumb } from "../../components/Breadcrumb";
import { CommitmentsSection } from "../commitments/CommitmentsSection";
import { HandoverPacketDrawer } from "../sales-handover/HandoverPacketDrawer";
import { CaseDrawer as RegistrationCaseDrawer } from "../registration/CaseDrawer";
import { HandoverCaseDrawer } from "../handover/HandoverCaseDrawer";
import { CommunicationsPanel } from "../communications/CommunicationsPanel";
import { InternalNotesPanel } from "../communications/InternalNotesPanel";

const COMMITMENT_WRITE_ROLES = new Set(["CRM", "SUPER_ADMIN"]);

export function Booking360({
  bookingId,
  roles,
  onBack,
  onOpenUnit,
  onOpenCustomer,
}: {
  bookingId: string;
  roles: string[];
  onBack: () => void;
  onOpenUnit?: (unitId: string) => void;
  onOpenCustomer?: (customerId: string) => void;
}) {
  const [view, setView] = useState<Booking360View | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<string | undefined>(undefined);
  const [openingHandoverPacket, setOpeningHandoverPacket] = useState(false);
  const [openingRegistration, setOpeningRegistration] = useState(false);
  const [openingHandoverCase, setOpeningHandoverCase] = useState(false);
  // 31-intelligence.md rule 3 — own fetches, not blocking the main view (undefined = still
  // loading, null = failed to load; either renders as a skeleton/nothing rather than an error
  // banner for the whole page, since these two cards are additive to an otherwise-working screen).
  const [financialHealth, setFinancialHealth] = useState<Score | null | undefined>(undefined);
  const [journeyRisk, setJourneyRisk] = useState<Score | null | undefined>(undefined);

  const load = useCallback(() => {
    setError(false);
    threeSixtyApi.getBooking360(bookingId).then(setView).catch(() => setError(true));
    threeSixtyApi.getFinancialHealth(bookingId).then(setFinancialHealth).catch(() => setFinancialHealth(null));
    threeSixtyApi.getJourneyRisk(bookingId).then(setJourneyRisk).catch(() => setJourneyRisk(null));
  }, [bookingId]);

  useEffect(() => {
    setView(undefined);
    setTab(undefined);
    setFinancialHealth(undefined);
    setJourneyRisk(undefined);
    load();
    threeSixtyApi.setMyContext({ entity_type: "booking", entity_id: bookingId }).catch(() => {});
  }, [bookingId, load]);

  const canWriteCommitments = roles.some((r) => COMMITMENT_WRITE_ROLES.has(r));

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {error && <EmptyState icon={CircleAlert} message="Couldn't load this booking." />}
      {!error && view === undefined && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {view && (
        <>
          <Project360Header projectId={view.project_id} />

          <Breadcrumb
            items={[
              { label: "Portfolio" },
              { label: "Bookings" },
              { label: view.booking_number },
            ]}
          />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-large font-bold">{view.booking_number}</h1>
              <p className="mt-1 text-subhead text-fg-muted">
                {view.unit && (
                  onOpenUnit ? (
                    <button className="text-accent hover:underline" onClick={() => onOpenUnit(view.unit!.id)}>
                      Villa {view.unit.unit_number}
                    </button>
                  ) : (
                    `Villa ${view.unit.unit_number}`
                  )
                )}
                {view.customer && (
                  <>
                    {" · "}
                    {onOpenCustomer ? (
                      <button className="text-accent hover:underline" onClick={() => onOpenCustomer(view.customer!.id)}>
                        {view.customer.display_name}
                      </button>
                    ) : (
                      view.customer.display_name
                    )}
                  </>
                )}
              </p>
            </div>
            <Badge tone="accent">{view.status}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ScoreCard label="Booking Readiness" {...scoreCardProps(view.booking_readiness)} />
            <ScoreCard label="Handover Readiness" {...scoreCardProps(view.handover_readiness)} />
            {financialHealth ? <ScoreCard label="Financial Health" {...scoreCardProps(financialHealth)} /> : financialHealth === undefined ? <Skeleton className="h-32 w-full" /> : null}
            {journeyRisk ? <ScoreCard label="Journey Risk" {...scoreCardProps(journeyRisk)} /> : journeyRisk === undefined ? <Skeleton className="h-32 w-full" /> : null}
          </div>

          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="mb-3 text-subhead font-semibold text-fg">Next actions</h2>
            {view.next_actions.length === 0 ? (
              <p className="text-footnote text-fg-muted">Nothing outstanding.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.next_actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-footnote">
                    <span className="text-fg">{a.title}</span>
                    <Badge>{a.priority}</Badge>
                    <span className="text-fg-subtle">{a.owner_role}</span>
                    {a.due_at && <span className="ml-auto text-fg-subtle">Due {new Date(a.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpeningHandoverPacket(true)}>
              <FileText className="h-4 w-4" /> Sales handover packet
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpeningRegistration(true)}>
              <Scale className="h-4 w-4" /> Registration case
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpeningHandoverCase(true)}>
              <ListChecks className="h-4 w-4" /> Handover case
            </Button>
          </div>

          <Tabs value={tab ?? view.tabs[0]?.key} onValueChange={setTab}>
            <div className="overflow-x-auto">
              <TabsList>
                {view.tabs.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="shrink-0 whitespace-nowrap">
                    {t.label}
                    <TabBadge entry={t} />
                  </TabsTrigger>
                ))}
                <TabsTrigger value="notes" className="shrink-0 whitespace-nowrap">Notes</TabsTrigger>
              </TabsList>
            </div>

            {view.tabs.map((t) => (
              <TabsContent key={t.key} value={t.key}>
                {t.key === "activity" && <ActivityFeed entityType="booking" entityId={bookingId} />}
                {t.key === "commitments" && <CommitmentsSection bookingId={bookingId} canWrite={canWriteCommitments} />}
                {t.key === "communications" && (view.customer
                  ? <CommunicationsPanel customerId={view.customer.id} bookingId={bookingId} roles={roles} />
                  : <TabPanel entry={t} />)}
                {t.key !== "activity" && t.key !== "commitments" && t.key !== "communications" && <TabPanel entry={t} />}
              </TabsContent>
            ))}
            <TabsContent value="notes">
              <InternalNotesPanel entityType="booking" entityId={bookingId} />
            </TabsContent>
          </Tabs>

          <HandoverPacketDrawer bookingId={openingHandoverPacket ? bookingId : null} onClose={() => setOpeningHandoverPacket(false)} onChanged={load} />
          <RegistrationCaseDrawer bookingId={openingRegistration ? bookingId : null} roles={roles} onClose={() => setOpeningRegistration(false)} onChanged={load} />
          <HandoverCaseDrawer bookingId={openingHandoverCase ? bookingId : null} roles={roles} onClose={() => setOpeningHandoverCase(false)} />
        </>
      )}
    </div>
  );
}
