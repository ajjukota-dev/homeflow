import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AuditRow } from "../api-events";
import { Card, CardBody } from "../ui/Card";
import { Segmented } from "../ui/Segmented";
import { eventDescription, eventFamily } from "../lib/labels";

// Reusable "Activity" tab for Booking/Unit/Customer 360 (spec 02 Screens): renders the
// append-only event log in plain language, filterable by family. Loading/empty/error states.

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ActivityFeed({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [events, setEvents] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [family, setFamily] = useState<string>("all");

  useEffect(() => {
    setEvents(null);
    setError(null);
    api
      .audit(entityType, entityId)
      .then(setEvents)
      .catch(() => setError("Couldn't load activity. Try again."));
  }, [entityType, entityId]);

  const families = useMemo(() => {
    if (!events) return [];
    return Array.from(new Set(events.map((e) => eventFamily(e.type)))).sort();
  }, [events]);

  const visible = useMemo(() => {
    if (!events) return [];
    return family === "all" ? events : events.filter((e) => eventFamily(e.type) === family);
  }, [events, family]);

  if (error) {
    return (
      <Card>
        <CardBody className="text-subhead text-overdue">{error}</CardBody>
      </Card>
    );
  }

  if (!events) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading activity">
        <div className="h-14 animate-pulse rounded-xl border border-line bg-surface-2" />
        <div className="h-14 animate-pulse rounded-xl border border-line bg-surface-2" />
        <div className="h-14 animate-pulse rounded-xl border border-line bg-surface-2" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardBody className="text-subhead text-fg-muted">No activity recorded yet.</CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {families.length > 1 && (
        <Segmented
          ariaLabel="Filter activity by family"
          value={family}
          onChange={setFamily}
          options={[{ value: "all", label: "All" }, ...families.map((f) => ({ value: f, label: f }))]}
        />
      )}
      <ol className="flex flex-col gap-2">
        {visible.map((e) => (
          <li key={e.id}>
            <Card>
              <CardBody className="flex items-baseline gap-3">
                <span className="text-subhead text-fg">{eventDescription(e)}</span>
                <time className="ml-auto shrink-0 text-footnote text-fg-muted" dateTime={e.occurred_at}>
                  {relativeTime(e.occurred_at)}
                </time>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
