// Phase 3: task + journey display helpers. Kept UI-agnostic.

import {
  Circle,
  ListChecks,
  Paperclip,
  BadgeCheck,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

// Spec §100 mapping — every status renders with a colour AND a text label.
export const TASK_STATUS_TONE = {
  "Not Started": "grey",
  "In Progress": "blue",
  "Waiting for Customer": "amber",
  "Waiting for Internal Team": "amber",
  "Waiting for External Party": "amber",
  Blocked: "red",
  "Awaiting Verification": "purple",
  "Awaiting Approval": "purple",
  Completed: "green",
  Cancelled: "grey",
  Overdue: "darkred",
};

export const JOURNEY_STATUS_TONE = {
  Active: "green",
  OnHold: "amber",
  Closed: "grey",
  Cancelled: "red",
};

export const STAGE_STATUS_TONE = {
  "Not Started": "grey",
  "In Progress": "blue",
  Completed: "green",
  Skipped: "grey",
};

export const RISK_TONE = {
  Low: "grey",
  Medium: "amber",
  High: "orange",
  Critical: "darkred",
};

export const PRIORITY_TONE = {
  Low: "grey",
  Medium: "blue",
  High: "orange",
  Critical: "red",
};

export const EXECUTION_ICONS = {
  Simple: Circle,
  Checklist: ListChecks,
  Evidence: Paperclip,
  Verification: ShieldCheck,
  Approval: BadgeCheck,
  External: ExternalLink,
};

export const WAITING_STATUSES = [
  "Waiting for Customer",
  "Waiting for Internal Team",
  "Waiting for External Party",
];

// Given a task doc, return the best-effort display status (Overdue overlay is
// already computed on the server as `display_status`).
export function displayTaskStatus(task) {
  return task?.display_status || task?.status || "Not Started";
}

// Compute a rough "next best actions" list for a loaded journey.
// Priority: In Progress / Awaiting * first, then not-blocked Not Started, then blocked.
export function pickNextBestActions(journey, currentUserId, limit = 3) {
  const all = [];
  for (const st of journey?.stages || []) {
    for (const sub of st.subprocesses || []) {
      for (const t of sub.tasks || []) {
        if (t.status === "Completed" || t.status === "Cancelled") continue;
        all.push({ ...t, _stage: st, _sub: sub });
      }
    }
  }
  const score = (t) => {
    let s = 0;
    if (t.owner_user_id === currentUserId) s += 3;
    if (t.status === "In Progress") s += 4;
    if (t.status === "Awaiting Verification" || t.status === "Awaiting Approval") s += 3.5;
    if (t.overdue) s += 5;
    if (t.priority === "Critical") s += 4;
    else if (t.priority === "High") s += 2.5;
    else if (t.priority === "Medium") s += 1;
    if (!t.blocker_reason) s += 2;
    return s;
  };
  all.sort((a, b) => score(b) - score(a));
  return all.slice(0, limit);
}

export function entityPathForTask(task) {
  if (!task) return "/dashboard";
  if (task._journey_summary?.customer_id) {
    return `/customers/${task._journey_summary.customer_id}?tab=journey&task=${task.id}`;
  }
  if (task._customer?.id) {
    return `/customers/${task._customer.id}?tab=journey&task=${task.id}`;
  }
  return "/dashboard";
}
