import { useEffect, useState } from "react";
import { PageHeader, Skeleton, EmptyState, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Button, Card, CardBody, Avatar } from "@homeflow/ui";
import { CalendarClock, AlertTriangle, Clock3, ClipboardCheck, HeartHandshake, Users } from "lucide-react";
import { mydayApi, type MyDayAction, type MyDayView, type TeamDayView } from "./api";
import { adminApi } from "../../auth/adminApi";

// 11-my-day-ranking.md. Rule 1's five sections rendered as Tabs (satisfies "collapsible lists" on
// desktop and "sections as tabs" at 375 with one layout, not two — a deliberate simplification,
// noted in this spec's own Build note). Two real, honest scope cuts vs. the Screens section's
// description, both flagged there too: no entity chip (Booking/Unit) or owner avatar per row —
// `GET /me/day` returns action id/code/title/status/due_at/score/why_now only, no booking/unit/
// owner join; and no primary action button (Start/Approve/Upload evidence) opening an Action
// drawer — that drawer is spec 10's own still-deferred UI, so this view is read-only for now.

const SECTIONS: { key: keyof Omit<MyDayView, "done_today">; label: string; icon: typeof CalendarClock; empty: string }[] = [
  { key: "due_today", label: "Due today", icon: CalendarClock, empty: "Nothing due today." },
  { key: "at_risk", label: "At risk", icon: AlertTriangle, empty: "Nothing at risk right now." },
  { key: "waiting_on_me", label: "Waiting on me", icon: Clock3, empty: "Nothing waiting on you." },
  { key: "needs_my_approval", label: "Needs my approval", icon: ClipboardCheck, empty: "Nothing needs your approval." },
  { key: "customers_waiting", label: "Customers waiting", icon: HeartHandshake, empty: "No customers waiting on you." },
];

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  return new Date(dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function ActionRow({ a }: { a: MyDayAction }) {
  const due = formatDue(a.due_at);
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-caption text-fg-subtle">{a.code}</span>
          <div className="truncate text-subhead font-semibold">{a.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {due && <span className="text-footnote text-fg-subtle">{due}</span>}
          <Badge>{a.status}</Badge>
        </div>
      </div>
      <p className="text-footnote text-fg-muted">{a.why_now}</p>
    </li>
  );
}

function SectionList({ actions, emptyMessage, icon }: { actions: MyDayAction[]; emptyMessage: string; icon: typeof CalendarClock }) {
  if (actions.length === 0) return <EmptyState icon={icon} message={emptyMessage} />;
  return <ul className="flex flex-col">{actions.map((a) => <ActionRow key={a.id} a={a} />)}</ul>;
}

function TeamView({ projectId }: { projectId: string }) {
  const [team, setTeam] = useState<TeamDayView | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    setTeam(null);
    setError(false);
    if (!projectId) return;
    mydayApi
      .getTeamDay(projectId)
      .then(setTeam)
      .catch(() => setError(true));
    // Best-effort name resolution: /api/admin/users requires WRITE on "administration" (MANAGEMENT/
    // SUPER_ADMIN today), which a CENTRAL-team primary-owner head calling this same team view may
    // not hold — fall back to the raw user id rather than blocking the view on a 403.
    adminApi
      .listUsers()
      .then((users) => setNames(Object.fromEntries(users.map((u) => [u.id, u.display_name]))))
      .catch(() => {});
  }, [projectId]);

  if (error) return <EmptyState icon={Users} message="Couldn't load the team view for this project." />;
  if (team === null) return <Skeleton />;
  const memberIds = Object.keys(team);
  if (memberIds.length === 0) return <EmptyState icon={Users} message="No team members assigned to this project yet." />;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {memberIds.map((id) => {
        const m = team[id];
        const name = names[id] ?? id;
        return (
          <Card key={id}>
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Avatar name={name} size="sm" />
                <span className="truncate font-semibold">{name}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SECTIONS.map((s) => (
                  <Badge key={s.key}>{s.label}: {m.counts[s.key] ?? 0}</Badge>
                ))}
              </div>
              {m.top3.length > 0 ? (
                <ul className="flex flex-col">{m.top3.map((a) => <ActionRow key={a.id} a={a} />)}</ul>
              ) : (
                <p className="text-footnote text-fg-subtle">Nothing open.</p>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/** Rule 9's "workspace home after login" is a live decision conflict with this app's own already-
 *  built `nav.ts::ROLE_HOME` (every role already lands on its own department module) — resolved
 *  additively rather than overriding that: My Day gets its own nav entry for every staff role
 *  instead of replacing ROLE_HOME, flagged in the Build note as a judgment call, not silently
 *  picked. */
export function MyDay({ projectId, isTeamHead }: { projectId: string; isTeamHead: boolean }) {
  const [day, setDay] = useState<MyDayView | null>(null);
  const [error, setError] = useState(false);
  const [teamView, setTeamView] = useState(false);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  function load() {
    setError(false);
    mydayApi
      .getMyDay(projectId || undefined)
      .then(setDay)
      .catch(() => setError(true));
  }
  useEffect(() => {
    setDay(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const allEmpty = day && SECTIONS.every((s) => day[s.key].length === 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Day"
        description={today}
        actions={
          isTeamHead ? (
            <Button variant="secondary" size="sm" onClick={() => setTeamView((v) => !v)}>
              {teamView ? "My view" : "Team view"}
            </Button>
          ) : undefined
        }
      />

      {teamView && isTeamHead ? (
        <TeamView projectId={projectId} />
      ) : error ? (
        <EmptyState icon={CalendarClock} message="Couldn't load My Day." action={{ label: "Retry", onClick: load }} />
      ) : day === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : allEmpty ? (
        <EmptyState icon={CalendarClock} message="Nothing due right now." />
      ) : (
        <Tabs defaultValue="due_today">
          <TabsList>
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label} ({day[s.key].length})
              </TabsTrigger>
            ))}
          </TabsList>
          {SECTIONS.map((s) => (
            <TabsContent key={s.key} value={s.key}>
              <SectionList actions={day[s.key]} emptyMessage={s.empty} icon={s.icon} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {day !== null && !teamView && (
        <p className="text-footnote text-fg-subtle">{day.done_today} done today.</p>
      )}
    </div>
  );
}
