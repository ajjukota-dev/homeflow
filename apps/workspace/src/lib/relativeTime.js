// Compact relative-time formatter.
export function relTime(input) {
  if (!input) return "";
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 45) return "just now";
  if (diff < 90) return "1m ago";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 5400) return "1h ago";
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 172800) return "yesterday";
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  const d = new Date(input);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
