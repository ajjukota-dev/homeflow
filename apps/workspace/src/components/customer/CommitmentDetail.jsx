import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Play, Send, CheckCircle2, BadgeCheck, XCircle, UserRoundCheck, Ban } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import { COMMITMENT_STATUS_TONE, APPROVAL_STATUS_TONE, displayCommitmentStatus } from "@/lib/documents";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function CommitmentDetail({ cid, open, onClose, onChanged }) {
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(null); // 'Approved' | 'Rejected'
  const [notes, setNotes] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    if (!cid) return;
    try {
      const r = await api.get(`/commitments/${cid}`);
      setC(r.data);
    } catch (e) {
      apiErrorToast(e);
    }
  }, [cid]);

  useEffect(() => { if (open && cid) load(); }, [open, cid, load]);

  if (!open) return null;
  if (!c) return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Loading commitment…</SheetTitle>
          <SheetDescription>Please wait</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );

  const role = user?.role?.code;
  const isMgmt = isSuperAdmin(user) || role === "MANAGEMENT";
  const isOwner = c.owner_user_id === user?.id;
  const isCRM = role === "CRM";
  const status = displayCommitmentStatus(c);

  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      if (msg) toast.success(msg);
      await load();
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const submitForApproval = () => run(async () => { await api.post(`/commitments/${c.id}/submit-for-approval`); }, "Submitted for approval");
  const decide = async () => {
    if (!decisionOpen) return;
    await run(async () => {
      await api.post(`/commitments/${c.id}/approve`, { decision: decisionOpen, notes: notes.trim() || undefined });
    }, `${decisionOpen}`);
    setDecisionOpen(null); setNotes("");
  };
  const start = () => run(async () => { await api.post(`/commitments/${c.id}/start`); }, "Marked in progress");
  const complete = () => run(async () => { await api.post(`/commitments/${c.id}/complete`); }, "Completed");
  const customerConfirm = () => run(async () => { await api.post(`/commitments/${c.id}/customer-confirm`); }, "Customer confirmation recorded");
  const cancel = async () => {
    if (!cancelReason.trim()) return;
    await run(async () => {
      await api.post(`/commitments/${c.id}/cancel`, { reason: cancelReason.trim() });
    }, "Cancelled");
    setCancelOpen(false); setCancelReason("");
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose?.()}>
      <SheetContent side="right" className="sm:max-w-2xl w-full p-0 overflow-y-auto" data-testid="commitment-detail">
        <SheetHeader className="px-5 py-3 border-b border-gray-200">
          <SheetTitle className="text-base font-heading font-semibold text-gray-900" data-testid="commit-detail-title">
            <span className="font-mono text-xs text-gray-500 mr-2">{c.code}</span>{c.category}
          </SheetTitle>
          <SheetDescription className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
            <StatusPill status={status} tone={COMMITMENT_STATUS_TONE[status]} testId="commit-detail-status" />
            <StatusPill status={c.approval_status} tone={APPROVAL_STATUS_TONE[c.approval_status]} />
            {c.overdue && <span className="text-red-700 font-medium">Overdue</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-900 whitespace-pre-line" data-testid="commit-detail-description">{c.description}</div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Cell k="Committed by" v={c.committed_by} sub="user id" />
            <Cell k="Committed on" v={c.committed_date ? formatDate(c.committed_date) : "—"} />
            <Cell k="Target" v={c.target_date ? formatDate(c.target_date) : "—"} />
            <Cell k="Impact" v={c.financial_impact_inr != null ? formatINR(c.financial_impact_inr) : "—"} />
            <Cell k="Owner" v={c.owner_user_id || "—"} sub="user id" />
            <Cell k="Department" v={c._department?.name || "—"} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {c.delivery_status === "Draft" && (isSuperAdmin(user) || c.committed_by === user?.id) && (
              <Button size="sm" onClick={submitForApproval} disabled={busy} data-testid="commit-submit-approval">
                <Send className="h-3.5 w-3.5" /> Submit for approval
              </Button>
            )}
            {c.delivery_status === "Awaiting Approval" && isMgmt && c.committed_by !== user?.id && (
              <>
                <Button size="sm" onClick={() => setDecisionOpen("Approved")} disabled={busy} data-testid="commit-approve">
                  <BadgeCheck className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDecisionOpen("Rejected")} disabled={busy} data-testid="commit-reject">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
            {(c.delivery_status === "Approved" || (c.delivery_status === "Draft" && !c.approval_required)) && (
              <Button size="sm" onClick={start} disabled={busy} data-testid="commit-start"><Play className="h-3.5 w-3.5" /> Start</Button>
            )}
            {c.delivery_status === "In Progress" && (isOwner || isSuperAdmin(user)) && (
              <Button size="sm" onClick={complete} disabled={busy} data-testid="commit-complete">
                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
              </Button>
            )}
            {c.delivery_status === "Completed" && (isCRM || isSuperAdmin(user)) && (
              <Button size="sm" onClick={customerConfirm} disabled={busy} data-testid="commit-customer-confirm">
                <UserRoundCheck className="h-3.5 w-3.5" /> Record customer confirmation
              </Button>
            )}
            {isSuperAdmin(user) && !["Completed", "Customer Confirmed", "Cancelled"].includes(c.delivery_status) && (
              <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)} disabled={busy} data-testid="commit-cancel">
                <Ban className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>

          {c.approval_notes && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
              <div className="font-medium text-gray-800">Approval notes</div>
              <div className="text-gray-600 whitespace-pre-line mt-0.5">{c.approval_notes}</div>
            </div>
          )}

          <div className="border border-gray-200 rounded-md p-3">
            <div className="text-xs font-medium text-gray-900 mb-2">Collaboration</div>
            <CollaborationPanel entityType="customer_commitment" entityId={c.id} entityTitle={`${c.code} — ${c.category}`} inline />
          </div>
        </div>

        <Dialog open={Boolean(decisionOpen)} onOpenChange={(v) => !v && setDecisionOpen(null)}>
          <DialogContent data-testid="commit-approval-dialog">
            <DialogHeader>
              <DialogTitle>{decisionOpen} commitment</DialogTitle>
              <DialogDescription>Notes are recorded and audit-logged.</DialogDescription>
            </DialogHeader>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm min-h-[80px]" data-testid="commit-approval-notes" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setDecisionOpen(null); setNotes(""); }}>Cancel</Button>
              <Button onClick={decide} disabled={busy} data-testid="commit-approval-confirm">{decisionOpen}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent data-testid="commit-cancel-dialog">
            <DialogHeader>
              <DialogTitle>Cancel commitment</DialogTitle>
              <DialogDescription>Reason required.</DialogDescription>
            </DialogHeader>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="text-sm min-h-[80px]" data-testid="commit-cancel-reason" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCancelOpen(false)}>Cancel</Button>
              <Button onClick={cancel} disabled={!cancelReason.trim() || busy} data-testid="commit-cancel-confirm">Confirm cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Cell({ k, v, sub }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{k}</div>
      <div className="text-sm text-gray-900 mt-0.5 truncate" title={String(v || "")}>{v ?? "—"}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}
