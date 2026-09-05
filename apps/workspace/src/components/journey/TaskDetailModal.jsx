import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  X,
  Upload,
  ExternalLink,
  UserPlus,
  Play,
  PauseCircle,
  Send,
  ShieldCheck,
  BadgeCheck,
  CheckCircle2,
  MessageSquare,
  Paperclip,
  Loader2,
  FileText,
  Handshake,
  Lock,
  IndianRupee,
  Receipt,
  Scale,
  CalendarClock,
  FileSignature,
} from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import StatusPill from "@/components/StatusPill";
import BlockerBanner from "@/components/journey/BlockerBanner";
import CommentsTab from "@/components/collab/CommentsTab";
import FilesTab from "@/components/collab/FilesTab";
import ActivityTab from "@/components/collab/ActivityTab";
import { stageColorForName } from "@/lib/stageColors";
import {
  EXECUTION_ICONS,
  PRIORITY_TONE,
  TASK_STATUS_TONE,
  WAITING_STATUSES,
  displayTaskStatus,
} from "@/lib/journey";
import { formatDate, formatDateTime } from "@/lib/format";
import { canVerify } from "@/lib/collab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Polymorphic task modal. Handles every execution type.
 * The blocker banner is non-negotiable — when task.blocker_reason is set the
 * banner is rendered and the Complete button is hidden/disabled (spec §44).
 */
export default function TaskDetailModal({ taskId, open, onClose, onChanged }) {
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("details");
  const [users, setUsers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const reload = async () => {
    if (!taskId) return;
    try {
      const r = await api.get(`/tasks/${taskId}`);
      setTask(r.data);
    } catch (e) {
      apiErrorToast(e);
    }
  };

  useEffect(() => {
    if (!open || !taskId) return;
    setTask(null);
    setTab("details");
    setLoading(true);
    (async () => {
      try {
        await reload();
      } finally {
        // Non-privileged users get 403 on /users; treat as an empty list so the
        // reassign dropdown just has no options rather than blowing up the modal.
        try {
          const uRes = await api.get(`/users`);
          setUsers(uRes.data || []);
        } catch {
          setUsers([]);
        }
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, open]);

  const isBlocked = Boolean(task?.blocker_reason);
  const lockedDomain = useMemo(() => {
    // Phase 5 + 6: T5/T6/T7/T8/T9/T10 are managed exclusively via domain screens.
    // Match the server-side DOMAIN_GATED_KEYS map in backend/routers/tasks.py.
    const key = task?._template_key;
    if (!key) return null;
    if (key === "T5") {
      return { key, screen: "Legal", tab: "legal", icon: Scale, hint: "Upload the agreement draft in Legal to progress this task.", auto: "Uploading the first draft auto-completes T5." };
    }
    if (key === "T6") {
      return { key, screen: "Legal", tab: "legal", icon: Scale, hint: "Approve the agreement draft in Legal to complete this task.", auto: "Approving the draft auto-completes T5 + T6. Rejecting reverses them." };
    }
    if (key === "T7") {
      return { key, screen: "Financials", tab: "financials", icon: IndianRupee, hint: "Verify the booking-amount payment in Financials.", auto: "Verifying the payment for the booking-amount milestone auto-completes T7." };
    }
    if (key === "T8") {
      return { key, screen: "Financials", tab: "financials", icon: Receipt, hint: "Verify the TDS challan in Financials — or mark TDS Not Applicable.", auto: "Verifying the TDS challan (or marking it Not Applicable) auto-completes T8." };
    }
    if (key === "T9") {
      return { key, screen: "Registration", tab: "registration", icon: CalendarClock, hint: "Confirm customer availability in Registration.", auto: "Confirming customer availability auto-completes T9." };
    }
    if (key === "T10") {
      return { key, screen: "Registration", tab: "registration", icon: FileSignature, hint: "Book the SRO slot in Registration once all readiness gates are green.", auto: "Booking the SRO slot auto-completes T10." };
    }
    if (key === "T11") {
      return { key, screen: "Unit Readiness", tab: "unit-readiness", icon: FileSignature, hint: "Update component progress and declare Ready-for-QA in Unit Readiness.", auto: "Declaring Ready-for-QA (score ≥ 85 + ≥ 2 photos) auto-completes T11." };
    }
    if (key === "T12") {
      return { key, screen: "Snagging", tab: "snags", icon: Lock, hint: "Close all critical snags in Snagging to complete QA inspection.", auto: "T12 auto-completes when all critical snags are Closed (and T11 is Completed). Creating or reopening a critical snag reverses T12." };
    }
    if (key === "T13") {
      return { key, screen: "Handover", tab: "handover", icon: FileSignature, hint: "Record customer acknowledgement in Handover (requires gate=Green or override).", auto: "Recording acknowledgement auto-completes T13, marks Handover Executed, and flips the unit to Handed Over." };
    }
    return null;
  }, [task?._template_key]);
  const isDomainLocked = Boolean(lockedDomain);
  const status = displayTaskStatus(task);
  const isOwner = task?.owner_user_id === user?.id;
  const canAct = isSuperAdmin(user) || isOwner || (!task?.owner_user_id && task?.department_id === user?.department_id && task?.default_owner_role === user?.role?.code);

  const canVerifyTask = useMemo(() => {
    if (!task) return false;
    if (isSuperAdmin(user)) return true;
    if (!task.verifier_role) return canVerify(user);
    return task.verifier_role === user?.role?.code;
  }, [task, user]);

  const canApproveTask = useMemo(() => {
    if (!task) return false;
    if (isSuperAdmin(user)) return true;
    if (user?.role?.code === "MANAGEMENT") return true;
    return task.approver_role && task.approver_role === user?.role?.code;
  }, [task, user]);

  const run = async (fn) => {
    setSaving(true);
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setSaving(false);
    }
  };

  const onStart = () =>
    run(async () => {
      await api.post(`/tasks/${task.id}/start`);
      toast.success("Task started");
    });

  const onAssignSelf = () =>
    run(async () => {
      await api.post(`/tasks/${task.id}/assign`, { user_id: user.id });
      toast.success("Assigned to you");
    });

  const onAssignUser = (uid) =>
    run(async () => {
      await api.post(`/tasks/${task.id}/assign`, { user_id: uid || null });
      toast.success("Owner updated");
    });

  const onSetChecklist = (key, done) =>
    run(async () => {
      await api.patch(`/tasks/${task.id}/checklist`, { key, done });
    });

  const onAttachEvidence = () => fileRef.current?.click();

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entity_type", "task");
      form.append("entity_id", task.id);
      form.append("category", task.required_document_category || "Other");
      form.append("visibility", "Internal");
      const r = await api.post(`/attachments`, form, { headers: { "Content-Type": "multipart/form-data" } });
      await api.post(`/tasks/${task.id}/attach-evidence`, { attachment_id: r.data.id });
      toast.success("Evidence attached");
      await reload();
      onChanged?.();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setUploading(false);
    }
  };

  const onSubmitVerify = () =>
    run(async () => {
      await api.post(`/tasks/${task.id}/submit-for-verification`);
      toast.success("Submitted for verification");
    });

  const onVerifyDecision = (decision) => async (notes) =>
    run(async () => {
      await api.post(`/tasks/${task.id}/verify`, { decision, notes });
      toast.success(`Verification ${decision.toLowerCase()}`);
    });

  const onSubmitApproval = () =>
    run(async () => {
      await api.post(`/tasks/${task.id}/submit-for-approval`);
      toast.success("Submitted for approval");
    });

  const onApprovalDecision = (decision) => async (notes) =>
    run(async () => {
      await api.post(`/tasks/${task.id}/approve`, { decision, notes });
      toast.success(`Task ${decision.toLowerCase()}`);
    });

  const onCompleteSimple = () =>
    run(async () => {
      await api.post(`/tasks/${task.id}/complete`, {});
      toast.success("Task completed");
    });

  const onCompleteExternal = (ref, notes) =>
    run(async () => {
      await api.post(`/tasks/${task.id}/complete`, { external_reference: ref, notes });
      toast.success("Task completed");
    });

  const onSetWaiting = (statusStr, reason) =>
    run(async () => {
      await api.post(`/tasks/${task.id}/set-status`, { status: statusStr, reason });
      toast.success("Status updated");
    });

  const closeAndReset = () => {
    onClose?.();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeAndReset()}>
      <DialogContent className="max-w-4xl p-0 gap-0 max-h-[92vh] flex flex-col" data-testid="task-detail-modal">
        <DialogHeader className="px-5 py-3 border-b border-gray-200 flex-row items-start justify-between space-y-0 gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-heading font-semibold text-gray-900 truncate" data-testid="task-modal-title">
              {loading || !task ? "Loading task…" : task.title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-gray-500 flex items-center gap-2 flex-wrap">
              {task ? (
                <>
                  <span data-testid="task-modal-exec-type">{task.execution_type}</span>
                  {task._journey_summary?.customer_code && (
                    <>
                      <span>·</span>
                      <Link
                        to={`/customers/${task._journey_summary.customer_id}?tab=journey`}
                        className="text-navy-900 hover:underline font-mono text-[11px]"
                        data-testid="task-modal-customer-link"
                      >
                        {task._journey_summary.customer_code}
                      </Link>
                      <span className="truncate">{task._journey_summary.customer_name}</span>
                    </>
                  )}
                  {task._journey_summary?.stage_name && (() => {
                    const sc = stageColorForName(task._journey_summary.stage_name);
                    return (
                      <>
                        <span>·</span>
                        <span
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                          style={{ background: sc.bg }}
                          data-testid="task-modal-stage-chip"
                        >
                          {task._journey_summary.stage_name}
                        </span>
                        <span className="text-slate-500">/ {task._journey_summary.subprocess_name}</span>
                      </>
                    );
                  })()}
                </>
              ) : (
                <span>Loading task details…</span>
              )}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={closeAndReset}
            className="h-8 w-8 rounded-md text-gray-500 hover:bg-gray-100 flex items-center justify-center shrink-0"
            aria-label="Close"
            data-testid="task-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading || !task ? (
            <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Blocker banner — non-negotiable per spec §44/§113/§114 */}
              <BlockerBanner reason={task.blocker_reason} />

              {/* Phase 5 + 6: T5, T6, T7, T8, T9, T10 are managed exclusively through domain screens */}
              {lockedDomain && (
                <div
                  className="rounded-md border border-violet-300 bg-violet-100 text-violet-800 p-3 flex items-start gap-3"
                  data-testid="task-domain-lock-banner"
                >
                  <lockedDomain.icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" /> Managed via {lockedDomain.screen}
                    </div>
                    <div className="text-xs mt-0.5">
                      Task {lockedDomain.key} — {lockedDomain.hint} {lockedDomain.auto} Manual complete / verify is disabled.
                    </div>
                  </div>
                  {task._journey_summary?.customer_id && (
                    <Link
                      to={`/customers/${task._journey_summary.customer_id}?tab=${lockedDomain.tab}`}
                      className="shrink-0 inline-flex items-center gap-1 text-xs font-medium rounded-md border border-purple-300 bg-white text-purple-800 hover:bg-purple-100 px-2.5 py-1"
                      data-testid={`task-domain-open-${lockedDomain.tab}`}
                    >
                      Open {lockedDomain.screen}
                    </Link>
                  )}
                </div>
              )}

              {/* Header pills */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={status} tone={TASK_STATUS_TONE[status] || "grey"} testId="task-modal-status" />
                <StatusPill status={task.priority || "Medium"} tone={PRIORITY_TONE[task.priority] || "grey"} />
                {task.due_date && (
                  <span className={[
                    "text-[11px] px-2 py-0.5 rounded-full border",
                    task.overdue ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-600",
                  ].join(" ")}
                    data-testid="task-modal-due"
                  >
                    Due {formatDate(task.due_date)}
                  </span>
                )}
                {task.override_flag && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700">Override</span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 -mx-5 px-5" data-testid="task-modal-tabs">
                {[
                  { key: "details", label: "Details", icon: FileText },
                  { key: "comments", label: "Comments", icon: MessageSquare },
                  { key: "files", label: "Files", icon: Paperclip },
                  { key: "activity", label: "Activity", icon: BadgeCheck },
                ].map((tt) => {
                  const Icon = tt.icon;
                  const active = tab === tt.key;
                  return (
                    <button
                      key={tt.key}
                      type="button"
                      onClick={() => setTab(tt.key)}
                      className={[
                        "px-3 py-2 text-xs border-b-2 -mb-px flex items-center gap-1.5",
                        active ? "border-navy-900 text-navy-900 font-medium" : "border-transparent text-gray-600 hover:text-gray-900",
                      ].join(" ")}
                      data-testid={`task-modal-tab-${tt.key}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tt.label}
                    </button>
                  );
                })}
              </div>

              {tab === "details" && (
                <>
                  {task.description && (
                    <div className="text-sm text-gray-700 whitespace-pre-line">{task.description}</div>
                  )}

                  <MetaGrid task={task} users={users} onAssignUser={onAssignUser} canAct={canAct} />

                  {task.execution_type === "Checklist" && (
                    <ChecklistBlock task={task} onToggle={onSetChecklist} disabled={!canAct || saving || task.status === "Completed"} />
                  )}

                  {(task.execution_type === "Evidence" ||
                    task.execution_type === "Verification" ||
                    task.execution_type === "Approval") && !isDomainLocked && (
                    <EvidenceBlock
                      task={task}
                      onAttach={onAttachEvidence}
                      uploading={uploading}
                      canAct={canAct}
                      fileRef={fileRef}
                      onFileChosen={onFileChosen}
                    />
                  )}

                  {(task.execution_type === "Verification" ||
                    task.execution_type === "Evidence") &&
                    task.verification_required && !isDomainLocked && (
                      <VerificationBlock task={task} onVerify={onVerifyDecision} canVerify={canVerifyTask} disabled={saving} />
                    )}

                  {task.execution_type === "Approval" && !isDomainLocked && (
                    <ApprovalBlock task={task} onDecision={onApprovalDecision} canApprove={canApproveTask} disabled={saving} />
                  )}

                  {task.execution_type === "External" && (
                    <ExternalBlock task={task} onComplete={onCompleteExternal} canAct={canAct} disabled={saving} isBlocked={isBlocked} />
                  )}

                  {/* Timeline info */}
                  <div className="grid grid-cols-2 gap-3 text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                    {task.completed_at && <span>Completed {formatDateTime(task.completed_at)}</span>}
                    {task.verified_at && <span>Verified {formatDateTime(task.verified_at)}</span>}
                    {task.approved_at && <span>Approved {formatDateTime(task.approved_at)}</span>}
                    {task.updated_at && <span>Last updated {formatDateTime(task.updated_at)}</span>}
                  </div>
                </>
              )}

              {tab === "comments" && (
                <div className="border border-gray-200 rounded-md p-3">
                  <CommentsTab entityType="task" entityId={task.id} />
                </div>
              )}
              {tab === "files" && (
                <div className="border border-gray-200 rounded-md p-3">
                  <FilesTab entityType="task" entityId={task.id} />
                </div>
              )}
              {tab === "activity" && (
                <div className="border border-gray-200 rounded-md p-3">
                  <ActivityTab entityType="task" entityId={task.id} />
                </div>
              )}
            </div>
          )}
        </div>

        {task && tab === "details" && (
          <DialogFooter className="px-5 py-3 border-t border-gray-200 flex-row items-center justify-between gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {/* Phase 4: T1 "Submit booking pack to CRM" → open the Handover form directly */}
              {task.title === "Submit booking pack to CRM" && task._journey_summary?.journey_id && (
                <Link
                  to={`/sales-handover/${task._booking_id || ""}${task._booking_id ? "" : ""}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-navy-900 text-navy-900 hover:bg-brand-50 px-2.5 py-1.5"
                  data-testid="task-action-open-handover"
                  onClick={(e) => {
                    // Compute booking id from customer_id via a soft lookup (task doesn't have booking_id)
                    // If we don't have it directly, fetch the journey and derive booking_id.
                    if (!task._booking_id) {
                      e.preventDefault();
                      api.get(`/journeys/${task._journey_summary.journey_id}`).then((r) => {
                        const bookingId = r?.data?.booking_id;
                        if (bookingId) window.location.href = `/sales-handover/${bookingId}`;
                      });
                    }
                  }}
                >
                  <Handshake className="h-3.5 w-3.5" /> Open Handover Form
                </Link>
              )}
              {task.status === "Not Started" && canAct && !isDomainLocked && (
                <Button size="sm" onClick={onStart} disabled={saving || isBlocked} data-testid="task-action-start">
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
              )}
              {!task.owner_user_id && canAct && task.status !== "Completed" && !isDomainLocked && (
                <Button size="sm" variant="outline" onClick={onAssignSelf} disabled={saving} data-testid="task-action-assign-self">
                  <UserPlus className="h-3.5 w-3.5" /> Take task
                </Button>
              )}
              {task.status === "In Progress" && canAct && task.execution_type === "Simple" && !isBlocked && !isDomainLocked && (
                <Button size="sm" onClick={onCompleteSimple} disabled={saving} data-testid="task-action-complete-simple">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </Button>
              )}
              {task.status === "In Progress" && canAct && task.execution_type === "Checklist" && !isBlocked && !isDomainLocked && (
                <Button size="sm" onClick={onCompleteSimple} disabled={saving} data-testid="task-action-complete-checklist">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </Button>
              )}
              {task.execution_type === "Evidence" && task.status === "In Progress" && canAct && !isDomainLocked && (
                <>
                  <Button size="sm" variant="outline" onClick={onSubmitVerify} disabled={saving || !task.evidence_attachment_ids?.length} data-testid="task-action-submit-verify">
                    <Send className="h-3.5 w-3.5" /> Submit for verification
                  </Button>
                  {!isBlocked && (
                    <Button size="sm" onClick={onCompleteSimple} disabled={saving} data-testid="task-action-complete-evidence">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                    </Button>
                  )}
                </>
              )}
              {task.execution_type === "Verification" && task.status === "In Progress" && canAct && !isDomainLocked && (
                <Button size="sm" variant="outline" onClick={onSubmitVerify} disabled={saving} data-testid="task-action-submit-verify-v">
                  <Send className="h-3.5 w-3.5" /> Submit for verification
                </Button>
              )}
              {task.execution_type === "Approval" && task.status === "In Progress" && canAct && !isDomainLocked && (
                <Button size="sm" variant="outline" onClick={onSubmitApproval} disabled={saving} data-testid="task-action-submit-approval">
                  <Send className="h-3.5 w-3.5" /> Submit for approval
                </Button>
              )}
              {task.status === "In Progress" && canAct && !isDomainLocked && (
                <WaitingMenu onWait={onSetWaiting} disabled={saving} />
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaGrid({ task, users, onAssignUser, canAct }) {
  const [showAssign, setShowAssign] = useState(false);
  const owner = users.find((u) => u.id === task.owner_user_id);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-gray-200 bg-white p-3">
      <div>
        <div className="text-[10px] uppercase text-gray-500 tracking-wide">Owner</div>
        <div className="text-sm text-gray-900 mt-0.5 truncate">
          {owner ? owner.name : task.owner_user_id ? "—" : <span className="text-amber-700">Unassigned</span>}
        </div>
        {canAct && (
          <button
            type="button"
            onClick={() => setShowAssign((v) => !v)}
            className="mt-1 text-[11px] text-navy-900 hover:underline"
            data-testid="task-modal-reassign-toggle"
          >
            {showAssign ? "Cancel" : "Reassign…"}
          </button>
        )}
        {showAssign && (
          <div className="mt-1">
            <Select onValueChange={(v) => { onAssignUser(v === "__unassign__" ? null : v); setShowAssign(false); }}>
              <SelectTrigger className="h-7 text-xs" data-testid="task-modal-reassign-select">
                <SelectValue placeholder="Pick user…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassign__">— Unassign —</SelectItem>
                {users.filter((u) => u.active !== false).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} · {u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase text-gray-500 tracking-wide">Default role</div>
        <div className="text-sm text-gray-900 mt-0.5">{task.default_owner_role || "—"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-gray-500 tracking-wide">Verifier</div>
        <div className="text-sm text-gray-900 mt-0.5">{task.verifier_role || "—"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-gray-500 tracking-wide">Approver</div>
        <div className="text-sm text-gray-900 mt-0.5">{task.approver_role || "—"}</div>
      </div>
    </div>
  );
}

function ChecklistBlock({ task, onToggle, disabled }) {
  const items = task.checklist_state || [];
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white" data-testid="task-checklist">
      <div className="px-3 py-2 border-b border-gray-100 text-xs font-medium text-gray-900">Checklist</div>
      <ul className="divide-y divide-gray-100">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              checked={!!it.done}
              onChange={(e) => onToggle(it.key, e.target.checked)}
              disabled={disabled}
              className="h-3.5 w-3.5"
              data-testid={`task-checklist-item-${it.key}`}
            />
            <span className={["text-sm flex-1", it.done ? "text-gray-500 line-through" : "text-gray-900"].join(" ")}>
              {it.label}
              {it.required && <span className="text-[10px] text-red-600 ml-1">*</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceBlock({ task, onAttach, uploading, canAct, fileRef, onFileChosen }) {
  const files = task.evidence_attachments || [];
  return (
    <div className="rounded-md border border-gray-200 bg-white" data-testid="task-evidence">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <div className="text-xs font-medium text-gray-900">
          Evidence {task.required_document_category ? `— ${task.required_document_category}` : ""}
        </div>
        {canAct && (
          <Button size="sm" variant="outline" onClick={onAttach} disabled={uploading} data-testid="task-evidence-attach">
            <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Attach evidence"}
          </Button>
        )}
      </div>
      <input
        type="file"
        ref={fileRef}
        className="hidden"
        onChange={onFileChosen}
        accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.csv"
        data-testid="task-evidence-file-input"
      />
      {files.length === 0 ? (
        <div className="p-3 text-xs text-gray-500">
          {task.evidence_required
            ? "No evidence attached. Attach at least one document to proceed."
            : "No evidence attached (optional)."}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm text-gray-900 truncate">{f.filename}</div>
                <div className="text-[11px] text-gray-500 truncate">v{f.version} · {f.category || "—"}</div>
              </div>
              <StatusPill status={f.verification_status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerificationBlock({ task, onVerify, canVerify, disabled }) {
  const [notes, setNotes] = useState("");
  const awaiting = task.status === "Awaiting Verification" && task.verification_status === "Pending";
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2" data-testid="task-verify-block">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-purple-600" />
        <div className="text-xs font-medium text-gray-900">
          Verification {task.verifier_role ? `by ${task.verifier_role}` : ""}
        </div>
        {task.verification_status && task.verification_status !== "Not Required" && (
          <StatusPill status={task.verification_status} />
        )}
      </div>
      {task.verification_notes && (
        <div className="text-[12px] text-gray-600 border-l-2 border-gray-200 pl-2">
          {task.verification_notes}
        </div>
      )}
      {awaiting && canVerify && (
        <>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Verification notes (optional)"
            className="text-xs min-h-[60px]"
            data-testid="task-verify-notes"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onVerify("Verified")(notes)} disabled={disabled} data-testid="task-verify-approve">
              Verify
            </Button>
            <Button size="sm" variant="outline" onClick={() => onVerify("Rejected")(notes)} disabled={disabled} data-testid="task-verify-reject">
              Reject
            </Button>
          </div>
        </>
      )}
      {awaiting && !canVerify && (
        <div className="text-[12px] text-gray-500">
          Awaiting verification from {task.verifier_role || "the verifier role"}.
        </div>
      )}
    </div>
  );
}

function ApprovalBlock({ task, onDecision, canApprove, disabled }) {
  const [notes, setNotes] = useState("");
  const awaiting = task.status === "Awaiting Approval" && task.approval_status === "Pending";
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2" data-testid="task-approval-block">
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-purple-600" />
        <div className="text-xs font-medium text-gray-900">Approval {task.approver_role ? `by ${task.approver_role}` : ""}</div>
        {task.approval_status && task.approval_status !== "Not Required" && (
          <StatusPill status={task.approval_status} />
        )}
      </div>
      {task.approval_notes && (
        <div className="text-[12px] text-gray-600 border-l-2 border-gray-200 pl-2">{task.approval_notes}</div>
      )}
      {awaiting && canApprove && (
        <>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Approval notes (optional)"
            className="text-xs min-h-[60px]"
            data-testid="task-approval-notes"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onDecision("Approved")(notes)} disabled={disabled} data-testid="task-approval-approve">
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecision("Rejected")(notes)} disabled={disabled} data-testid="task-approval-reject">
              Reject
            </Button>
          </div>
        </>
      )}
      {awaiting && !canApprove && (
        <div className="text-[12px] text-gray-500">
          Awaiting approval from {task.approver_role || "the approver role"}.
        </div>
      )}
    </div>
  );
}

function ExternalBlock({ task, onComplete, canAct, disabled, isBlocked }) {
  const [ref, setRef] = useState(task.external_reference || "");
  const [notes, setNotes] = useState("");
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2" data-testid="task-external-block">
      <div className="flex items-center gap-2">
        <ExternalLink className="h-4 w-4 text-blue-600" />
        <div className="text-xs font-medium text-gray-900">
          External {task.external_party ? `— ${task.external_party}` : ""}
        </div>
      </div>
      <div className="grid gap-2">
        <div>
          <label className="text-[11px] text-gray-600">External reference *</label>
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="e.g. SRO/2026/45231"
            className="h-8 text-sm"
            data-testid="task-external-ref"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-600">Notes (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-xs min-h-[50px]"
            data-testid="task-external-notes"
          />
        </div>
        {canAct && task.status !== "Completed" && !isBlocked && (
          <Button
            size="sm"
            onClick={() => onComplete(ref.trim(), notes.trim())}
            disabled={disabled || !ref.trim()}
            data-testid="task-external-complete"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Complete with reference
          </Button>
        )}
      </div>
    </div>
  );
}

function WaitingMenu({ onWait, disabled }) {
  const [open, setOpen] = useState(false);
  const [statusStr, setStatusStr] = useState(WAITING_STATUSES[0]);
  const [reason, setReason] = useState("");
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        data-testid="task-action-wait-toggle"
      >
        <PauseCircle className="h-3.5 w-3.5" /> Set waiting…
      </Button>
      {open && (
        <div className="absolute bottom-9 right-0 w-72 rounded-md border border-gray-200 bg-white shadow-lg p-3 space-y-2 z-10" data-testid="task-action-wait-popover">
          <Select value={statusStr} onValueChange={setStatusStr}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WAITING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="text-xs min-h-[60px]"
            data-testid="task-action-wait-reason"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => { onWait(statusStr, reason.trim()); setOpen(false); setReason(""); }}
              disabled={!reason.trim()}
              data-testid="task-action-wait-submit"
            >
              Set
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
