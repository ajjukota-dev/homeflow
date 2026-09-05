import { AlertCircle } from "lucide-react";

/**
 * Amber "Missing — re-upload required" chip. Rendered when an
 * attachment payload comes back with `file_missing=true`.
 *
 * The chip is intentionally text-first (colour + label) so users on
 * assistive tech don't rely on colour alone.
 */
export default function MissingFileChip({ className = "" }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border border-amber-300 " +
        "bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 " +
        className
      }
      data-testid="attachment-missing-chip"
      title="This file is no longer available on the server. A user with upload permission must re-upload it."
    >
      <AlertCircle className="h-3 w-3" />
      Missing — re-upload required
    </span>
  );
}
