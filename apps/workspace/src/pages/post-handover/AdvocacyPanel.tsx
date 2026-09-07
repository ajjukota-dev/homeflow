import { useCallback, useEffect, useState } from "react";
import { Button, Input, Badge, EmptyState } from "@homeflow/ui";
import { Megaphone } from "lucide-react";
import { ApiError } from "../../auth/api";
import { postHandoverApi, type AdvocacyRow, type CheckInRow } from "./api";

const CRM_ROLES = ["CRM", "MANAGEMENT", "SUPER_ADMIN"];

/** Rule 6: "after a DAY_90 score >= 4, invite referral/testimonial (CRM publishes the invite — no
 *  auto-send)". `registerAdvocacySubscribers` already raises a CRM action on this event server-side
 *  (advocacy.ts) — this panel is where CRM actually clicks the invite it names, not a second
 *  automatic trigger. `listAdvocacy`/`inviteAdvocacy`/`respondAdvocacy` are all CRM-only server-side
 *  (`requireRole(ctx, CRM_UPDATE_ROLES)`, not the "handovers" module matrix the rest of this case
 *  view reads through) — FM genuinely cannot list this, so the tab must not even attempt the fetch
 *  for FM (found live: it 403'd and the panel misreported it as "Couldn't reach the API"). */
export function AdvocacyPanel({ bookingId, checkIns, roles }: { bookingId: string; checkIns: CheckInRow[]; roles: string[] }) {
  const canView = roles.some((r) => CRM_ROLES.includes(r));
  const [rows, setRows] = useState<AdvocacyRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [referredName, setReferredName] = useState("");

  const load = useCallback(() => {
    if (!canView) return;
    setError(false);
    postHandoverApi.advocacy(bookingId).then(setRows).catch(() => setError(true));
  }, [bookingId, canView]);

  useEffect(load, [load]);

  const day90 = checkIns.find((c) => c.kind === "DAY_90");
  const eligible = day90 && day90.score !== null && day90.score >= 4;

  async function invite(kind: "REFERRAL" | "TESTIMONIAL") {
    setBusy(kind);
    try {
      await postHandoverApi.inviteAdvocacy(bookingId, kind);
      load();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function respond(id: string, status: "RECEIVED" | "PUBLISHED" | "DECLINED") {
    setBusy(id);
    try {
      await postHandoverApi.respondAdvocacy(id, { status, referred_prospect_name: status === "RECEIVED" ? referredName.trim() || null : undefined });
      setReferredName("");
      load();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setBusy(null);
    }
  }

  if (!canView) return <p className="text-footnote text-fg-muted">Advocacy invites are managed by CRM — nothing to show here for your role.</p>;
  if (error) return <EmptyState icon={Megaphone} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />;
  if (rows === null) return <p className="text-footnote text-fg-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {eligible ? (
        <p className="text-footnote text-fg-muted">Day 90 score was {day90!.score}/5 — eligible for a referral or testimonial invite.</p>
      ) : (
        <p className="text-footnote text-fg-subtle">No DAY_90 score of 4+ yet — invites open up once the settling-in check-in comes back positive.</p>
      )}

      {canView && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => invite("REFERRAL")} disabled={busy !== null}>Invite: referral</Button>
          <Button size="sm" variant="secondary" onClick={() => invite("TESTIMONIAL")} disabled={busy !== null}>Invite: testimonial</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-footnote text-fg-muted">No advocacy activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-3 text-footnote">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg">{a.kind}</span>
                <Badge className={a.status === "PUBLISHED" ? "bg-ontrack/10 text-ontrack" : a.status === "DECLINED" ? "bg-overdue/10 text-overdue" : "bg-due/10 text-due"}>{a.status}</Badge>
              </div>
              {a.content && <p className="mt-1 text-fg-muted">{a.content}</p>}
              {canView && a.status === "INVITED" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  {a.kind === "REFERRAL" && <Input value={referredName} onChange={(e) => setReferredName(e.target.value)} placeholder="Referred prospect's name" className="max-w-[200px]" />}
                  <Button size="sm" onClick={() => respond(a.id, "RECEIVED")} disabled={busy === a.id}>Mark received</Button>
                  <Button size="sm" variant="ghost" onClick={() => respond(a.id, "DECLINED")} disabled={busy === a.id}>Declined</Button>
                </div>
              )}
              {canView && a.status === "RECEIVED" && (
                <div className="mt-2 border-t border-line pt-2">
                  <Button size="sm" onClick={() => respond(a.id, "PUBLISHED")} disabled={busy === a.id}>Publish</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
