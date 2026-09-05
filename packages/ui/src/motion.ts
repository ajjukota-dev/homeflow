/** Motion presets — docs/specs/32-design-system.md "Motion" + Rule 6 (authored moments).
 * One easing, three durations; everything else is a 160ms micro-interaction. Consumers pass
 * these into `motion` (framer-motion v12) `transition` props or CSS `transition-duration`.
 */
import { useEffect, useState } from "react";

/** Exponential ease-out — confident arrivals, never bounce/elastic. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 0.99] as const;

export const DURATION = {
  /** Micro-interactions: hover/press feedback, chip morph. */
  micro: 0.16,
  /** Panel transitions: drawers, popovers, tabs. */
  panel: 0.24,
  /** Page-level transitions. */
  page: 0.4,
} as const;

/** Detects `prefers-reduced-motion` and keeps it live if the OS setting changes mid-session. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/** A transition that respects reduced motion by collapsing to an opacity-only fade <=120ms. */
export function transition(kind: keyof typeof DURATION, reduced: boolean) {
  if (reduced) return { duration: 0.12, ease: "linear" as const };
  return { duration: DURATION[kind], ease: EASE_OUT_EXPO };
}

/** Authored moment: Drawer slide-in from the right (Rule 6). Content fades in 60ms later. */
export function drawerVariants(reduced: boolean) {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.12 } },
      exit: { opacity: 0, transition: { duration: 0.12 } },
    };
  }
  return {
    hidden: { x: "100%", opacity: 0.6 },
    visible: { x: 0, opacity: 1, transition: { duration: DURATION.panel, ease: EASE_OUT_EXPO } },
    exit: { x: "100%", opacity: 0.6, transition: { duration: DURATION.panel, ease: EASE_OUT_EXPO } },
  };
}

/** Authored moment: Drawer body content fades in 60ms after the panel starts sliding. */
export function drawerContentVariants(reduced: boolean) {
  if (reduced) return { hidden: { opacity: 0 }, visible: { opacity: 1 } };
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: DURATION.panel, delay: 0.06, ease: EASE_OUT_EXPO } },
  };
}

/** Authored moment: skeleton -> content crossfade. */
export function skeletonCrossfade(reduced: boolean) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: transition("micro", reduced) },
    exit: { opacity: 0, transition: transition("micro", reduced) },
  };
}

/** Authored moment: My Day style list stagger on first load (40ms per item, capped). */
export function listStagger(index: number, reduced: boolean) {
  if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.12 } } };
  const delay = Math.min(index * 0.04, 0.4);
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION.micro, delay, ease: EASE_OUT_EXPO } },
  };
}
