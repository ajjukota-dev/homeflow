import { useCallback, useEffect, useState } from "react";
import { Drawer, DrawerContent, Badge, Skeleton, EmptyState, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent } from "@homeflow/ui";
import { CheckCircle2, Circle, HeartHandshake, ShieldAlert } from "lucide-react";
import {
  postHandoverApi, CASE_STATUS_LABEL, MOVE_IN_TASK_LABEL, CHECKIN_KIND_LABEL,
  type PostHandoverCaseRow, type DlpWindowStatus, type CheckInRow, type MoveInTaskKey,
} from "./api";
import { WarrantyPanel } from "./WarrantyPanel";
import { PassportPanel } from "./PassportPanel";
import { ServiceHistoryPanel } from "./ServiceHistoryPanel";
import { AdvocacyPanel } from "./AdvocacyPanel";

// "handovers" module: SITE/FM WRITE, CRM/MANAGEMENT READ (seeded matrix). Mirrored client-side
// for gating, same as registration/CaseDrawer.tsx's own REGISTRATION_ROLES constant — the server
// re-checks on every write regardless.
const HANDOVERS_WRITE_ROLES = ["SITE", "FM", "MANAGEMENT", "SUPER_ADMIN"];
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const MOVE_IN_TASK_ORDER: MoveInTaskKey[] = [
  "facility_intro_done", "maintenance_setup_done", "owner_record_transferred", "warranties_shared",
  "pending_snag_monitoring", "utilities_transferred", "association_membership",
];

function MoveInChecklist({ row, canWrite, onChanged }: { row: PostHandoverCaseRow; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(key: MoveInTaskKey) {
    if (row.move_in_tasks[key].done) return;
    setBusy(key);
    try {
      await postHandoverApi.completeMoveInTask(row.id, key);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Move-in checklist</h3>
      <ul className="flex flex-col gap-1.5">
        {MOVE_IN_TASK_ORDER.map((key) => {
          const t = row.move_in_tasks[key];
          return (
            <li key={key} className="flex items-center gap-2 text-footnote">
              {canWrite ? (
                <Checkbox checked={t.done} disabled={t.done || busy === key} onCheckedChange={() => toggle(key)} aria-label={MOVE_IN_TASK_LABEL[key]} />
              ) : t.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-ontrack" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              )}
              <span className={t.done ? "text-fg-muted line-through" : "text-fg"}>{MOVE_IN_TASK_LABEL[key]}</span>
              {t.done && t.at && <span className="text-caption text-fg-subtle">{formatDate(t.at)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DlpWindowsBar({ windows }: { windows: DlpWindowStatus[] }) {
  if (windows.length === 0) return <p className="text-footnote text-fg-muted">No DLP policy resolved for this unit's product type yet.</p>;
  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Defect-liability windows</h3>
      <ul className="flex flex-col gap-1.5">
        {windows.map((w) => (
          <li key={w.category} className="flex items-center justify-between text-footnote">
            <span className="text-fg">{w.category} · {w.months} mo</span>
            <Badge className={w.expired ? "bg-surface-2 text-fg-subtle" : "bg-ontrack/10 text-ontrack"}>
              {w.expired ? `Expired ${formatDate(w.ends_on)}` : `Until ${formatDate(w.ends_on)}`}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckInScores({ checkIns }: { checkIns: CheckInRow[] }) {
  if (checkIns.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-subtle">Settling-in check-ins</h3>
      <ul className="flex flex-col gap-1.5">
        {checkIns.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-footnote">
            <span className="text-fg">{CHECKIN_KIND_LABEL[c.kind] ?? c.kind}</span>
            {c.score !== null ? (
              <Badge className={c.score <= 2 ? "bg-overdue/10 text-overdue" : "bg-ontrack/10 text-ontrack"}>
                {c.score <= 2 && <ShieldAlert className="mr-1 inline size-3" aria-hidden />}{c.score}/5
              </Badge>
            ) : (
              <span className="text-caption text-fg-subtle">{c.sent_at ? "Sent, not yet answered" : "Not sent"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 30-post-handover.md Screens: "case view (move-in checklist, DLP windows bar, warranty cases
 *  table, passport editor, service history, check-in scores, advocacy)". Rule 5's "UI must
 *  capture the real score (fix hardcoded 5)" is satisfied by 26's real portal check-in flow
 *  (Home.tsx's 1-5 star `CheckInPrompt`, already wired to `submitCheckIn`) — this view only
 *  displays the customer's own real answers, it never captures a score on their behalf; the
 *  legacy staff-side "Capture" button this replaces (PostHandover.tsx, hardcoded 5) is dropped
 *  entirely rather than reproduced. */
export function CaseDrawer({ bookingId, roles, onClose, onChanged }: { bookingId: string | null; roles: string[]; onClose: () => void; onChanged?: () => void }) {
  const canWrite = roles.some((r) => HANDOVERS_WRITE_ROLES.includes(r));
  const [row, setRow] = useState<PostHandoverCaseRow | null>(null);
  const [windows, setWindows] = useState<DlpWindowStatus[]>([]);
  const [checkIns, setCheckIns] = useState<CheckInRow[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!bookingId) return;
    setError(false);
    postHandoverApi
      .getCase(bookingId)
      .then((r) => {
        setRow(r);
        return Promise.all([postHandoverApi.dlpWindows(bookingId), postHandoverApi.checkIns(bookingId)]);
      })
      .then(([w, c]) => { setWindows(w); setCheckIns(c); })
      .catch(() => setError(true));
  }, [bookingId]);

  useEffect(() => { setRow(null); load(); }, [bookingId, load]);

  function notifyThenReload() { load(); onChanged?.(); }

  return (
    <Drawer open={bookingId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent open={bookingId !== null} title={row ? CASE_STATUS_LABEL[row.status] : "After keys"} width={640}>
        {error && <EmptyState icon={HeartHandshake} message="Couldn't reach the API on :3001." />}
        {!error && !row && (
          <div className="flex flex-col gap-3">
            <Skeleton variant="text" /><Skeleton variant="text" /><Skeleton variant="text" />
          </div>
        )}
        {!error && row && (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="warranty">Warranty</TabsTrigger>
              <TabsTrigger value="passport">Passport</TabsTrigger>
              <TabsTrigger value="history">Service history</TabsTrigger>
              <TabsTrigger value="advocacy">Advocacy</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="flex flex-col gap-5">
                <MoveInChecklist row={row} canWrite={canWrite} onChanged={notifyThenReload} />
                <DlpWindowsBar windows={windows} />
                <CheckInScores checkIns={checkIns} />
              </div>
            </TabsContent>
            <TabsContent value="warranty">
              <WarrantyPanel unitId={row.unit_id} bookingId={row.booking_id} canWrite={canWrite} onCaseCountChanged={onChanged} />
            </TabsContent>
            <TabsContent value="passport">
              <PassportPanel unitId={row.unit_id} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="history">
              <ServiceHistoryPanel unitId={row.unit_id} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="advocacy">
              <AdvocacyPanel bookingId={row.booking_id} checkIns={checkIns} roles={roles} />
            </TabsContent>
          </Tabs>
        )}
      </DrawerContent>
    </Drawer>
  );
}
