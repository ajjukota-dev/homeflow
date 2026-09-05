import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Custom type-scale suffixes from tailwind-preset.js (`text-ws-*`, `text-portal-*`). Without this,
 * tailwind-merge's default 'text-color' group (whose validator matches ANY string, to support
 * arbitrary theme colours) claims them too, and a size class silently deletes a colour class — or
 * vice versa — whenever both appear in the same `cn()` call (they do, in nearly every component). */
const CUSTOM_TEXT_SIZES = [
  "ws-xs", "ws-sm", "ws-body", "ws-md", "ws-lg", "ws-xl", "ws-2xl",
  "portal-sm", "portal-body", "portal-md", "portal-lg", "portal-xl", "portal-2xl", "portal-3xl",
];

const twMerge = extendTailwindMerge({
  override: {
    // tailwind-merge v3 defaults model Tailwind v4, where bare `outline` already implies a width
    // and so conflicts with `outline-{n}`. This repo is on Tailwind v3, where `outline` (style) and
    // `outline-2` (width) are independent utilities that must both be present for a visible focus
    // ring — every primitive's `focus-visible:outline ... outline-2 ... outline-accent` chain would
    // otherwise silently lose the bare `outline` class, breaking the focus indicator (WCAG 2.4.7).
    classGroups: {
      "outline-w": [{ outline: [(v: string) => /^\d+$/.test(v)] }],
    },
  },
  extend: {
    classGroups: {
      "font-size": [{ text: CUSTOM_TEXT_SIZES }],
      "outline-style": ["outline"],
    },
  },
});

/** Merge Tailwind class lists, later classes win on conflicting utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
