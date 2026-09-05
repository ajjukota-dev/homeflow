import { STATUS_PILL_CLASS, STATUS_TONE } from "@/lib/constants";

export default function StatusPill({ status, tone, label, testId }) {
  const t = tone || STATUS_TONE[status] || "grey";
  const cls = STATUS_PILL_CLASS[t] || STATUS_PILL_CLASS.grey;
  return (
    <span className={cls} data-testid={testId || `status-pill-${String(status || "unknown").toLowerCase().replace(/\s+/g, "-")}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current opacity-70`} aria-hidden />
      <span>{label ?? status}</span>
    </span>
  );
}
