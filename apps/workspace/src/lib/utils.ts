import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge that our custom `text-<size>` tokens are font-sizes, not colours —
// otherwise it treats `text-subhead` and `text-surface` as conflicting `text-*` classes
// and drops the colour (invisible button text).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "footnote", "subhead", "body", "title3", "title2", "title1", "large"] },
      ],
    },
  },
});

/** Merge Tailwind classes safely (conditional + conflict-resolving). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Format an ISO timestamp for IST display, e.g. "5 Sep 2026, 02:41" (spec: Asia/Kolkata). */
export function formatIstDateTime(iso: string): string {
  const part = (type: string) => IST_PARTS.formatToParts(new Date(iso)).find((p) => p.type === type)!.value;
  return `${part("day")} ${MONTHS[Number(part("month")) - 1]} ${part("year")}, ${part("hour")}:${part("minute")}`;
}
