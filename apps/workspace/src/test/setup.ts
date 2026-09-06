import "@testing-library/jest-dom";

// jsdom has no matchMedia — packages/ui's motion.ts::useReducedMotion (Drawer/Dialog/Tooltip/
// StatusChip all call it) throws without this. First hit by ActionDrawer.test.tsx, the first test
// to render a Drawer; global since every future Drawer/Dialog test would hit the same gap.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
