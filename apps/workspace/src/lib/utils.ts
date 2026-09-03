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
