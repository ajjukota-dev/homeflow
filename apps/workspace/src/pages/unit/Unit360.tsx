// 28-360-views.md rule 1 — Unit 360. Overview is read-only: no write endpoint exists anywhere in
// this codebase for a unit's physical fields (areas/price/facing) post-creation, so rule 1's
// "editable only by Site/Admin" has nothing to wire to yet — flagged, not faked, same discipline
// as this spec's own backend build note.
import { useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Home } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent, EmptyState, Skeleton, ScoreCard, KeyValue, Badge } from "@homeflow/ui";
import { threeSixtyApi, type Unit360View } from "../three-sixty/api";
import { scoreCardProps } from "../three-sixty/format";
import { TabPanel, TabBadge } from "../three-sixty/TabPanel";
import { ActivityFeed } from "../../components/ActivityFeed";
import { Project360Header } from "../../components/Project360Header";
import { Breadcrumb } from "../../components/Breadcrumb";
import { formatINR } from "../../ui/MoneyFigure";

export function Unit360({
  unitId,
  onBack,
  onOpenBooking,
}: {
  unitId: string;
  onBack: () => void;
  onOpenBooking?: (bookingId: string) => void;
}) {
  const [view, setView] = useState<Unit360View | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<string>("overview");

  useEffect(() => {
    setView(undefined);
    setError(false);
    setTab("overview");
    threeSixtyApi.getUnit360(unitId).then(setView).catch(() => setError(true));
    threeSixtyApi.setMyContext({ entity_type: "unit", entity_id: unitId }).catch(() => {});
  }, [unitId]);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {error && <EmptyState icon={CircleAlert} message="Couldn't load this unit." />}
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
              { label: view.hierarchy_path[0]?.name ?? "Project" },
              ...view.hierarchy_path.slice(1).map((n) => ({ label: n.name })),
              { label: `Villa ${view.unit_number}` },
            ]}
          />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-large font-bold">Villa {view.unit_number}</h1>
              <p className="mt-1 text-subhead text-fg-muted">
                {view.unit_type} · {view.product_type} · Facing {view.facing}
              </p>
            </div>
            <Badge tone="accent">{view.sale_status}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 className="mb-3 text-subhead font-semibold text-fg">Details</h2>
              <KeyValue
                items={[
                  { key: "Carpet area", value: view.areas.carpet_sqft ? `${view.areas.carpet_sqft} sqft` : "—" },
                  { key: "Built-up area", value: view.areas.built_up_sqft ? `${view.areas.built_up_sqft} sqft` : "—" },
                  { key: "Saleable area", value: view.areas.saleable_sqft ? `${view.areas.saleable_sqft} sqft` : "—" },
                  { key: "Plot", value: view.areas.plot_sqyd ? `${view.areas.plot_sqyd} sqyd` : "—" },
                  { key: "Base price", value: view.base_price_inr !== null ? formatINR(view.base_price_inr) : "—" },
                  {
                    key: "Current booking",
                    value: view.current_booking ? (
                      onOpenBooking ? (
                        <button className="text-accent hover:underline" onClick={() => onOpenBooking(view.current_booking!.id)}>
                          {view.current_booking.booking_number} ({view.current_booking.status})
                        </button>
                      ) : (
                        `${view.current_booking.booking_number} (${view.current_booking.status})`
                      )
                    ) : (
                      "None"
                    ),
                  },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ScoreCard label="Unit Readiness" {...scoreCardProps(view.readiness)} />
              <ScoreCard label="Change Flexibility" {...scoreCardProps(view.flexibility)} />
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="overview" className="shrink-0 whitespace-nowrap">
                  Overview
                </TabsTrigger>
                {view.tabs.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="shrink-0 whitespace-nowrap">
                    {t.label}
                    <TabBadge entry={t} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="overview">
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-4 text-footnote text-fg-muted">
                <Home className="h-4 w-4" /> Villa {view.unit_number} — see Details above for physical specs, price, and the linked booking.
              </div>
            </TabsContent>

            {view.tabs.map((t) => (
              <TabsContent key={t.key} value={t.key}>
                {t.key === "activity" ? <ActivityFeed entityType="unit" entityId={unitId} /> : <TabPanel entry={t} />}
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  );
}
