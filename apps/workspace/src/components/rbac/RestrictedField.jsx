import { Lock } from "lucide-react";

import { usePermissionLevel } from "@/context/PermissionsContext";
import { formatINR, formatDate } from "@/lib/format";

/**
 * RestrictedField — renders a value, or a "Restricted 🔒" chip if the value is
 * null AND the current role's permission on `module` is one of the redacting
 * modifiers (read_status_only / read_limited).
 *
 * <RestrictedField value={booking.agreement_value_inr} module="customer_financials" format="inr" />
 *
 * Behaviour:
 *   value defined         → formatted value (via `format`)
 *   value null, redacted  → chip
 *   value null, full read → renders `empty` fallback (default "—")
 */

const REDACTING = new Set(["read_status_only", "read_limited", "none"]);

function formatValue(value, format) {
  if (value == null) return "";
  if (format === "inr") return formatINR(value);
  if (format === "date") return formatDate(value);
  if (typeof format === "function") return format(value);
  return String(value);
}

export default function RestrictedField({
  value,
  module,
  format = "text",
  empty = "—",
  className = "",
  chipLabel = "Restricted",
  testId,
}) {
  const perm = usePermissionLevel(module);
  const isRedacted = value == null && REDACTING.has(perm);

  if (isRedacted) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 " +
          className
        }
        data-testid={testId || "restricted-field"}
        title="Your role can see this record's status but not its confidential value."
      >
        <Lock className="h-3 w-3" aria-hidden />
        {chipLabel}
      </span>
    );
  }

  if (value == null || value === "") {
    return (
      <span className={"text-slate-400 " + className} data-testid={testId}>
        {empty}
      </span>
    );
  }

  return (
    <span className={className} data-testid={testId}>
      {formatValue(value, format)}
    </span>
  );
}
