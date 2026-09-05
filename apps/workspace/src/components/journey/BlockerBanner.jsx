import { AlertTriangle } from "lucide-react";

/**
 * Red banner shown at the top of a task when `blocker_reason` is populated.
 * Renders the exact server-authored blocker text verbatim (spec §44, §113/§114).
 * Never suppressed; never rendered without the icon.
 */
export default function BlockerBanner({ reason, testId = "task-blocker-banner" }) {
  if (!reason) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800"
      data-testid={testId}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <div className="text-sm leading-tight">
        <div className="font-semibold" data-testid="task-blocker-banner-title">
          This task is blocked
        </div>
        <div className="text-[13px] mt-0.5" data-testid="task-blocker-banner-reason">
          {reason}
        </div>
      </div>
    </div>
  );
}
