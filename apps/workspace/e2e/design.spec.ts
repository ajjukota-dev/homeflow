import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Design system quality gates — spec docs/specs/32-design-system.md "Acceptance":
//   - Fonts load: computed font-family is Geist on body, Jost on h1/h2; no Segoe/Roboto.
//   - axe: 0 serious/critical on every preview page.
//   - Motion: reduced-motion collapses transitions to <= 120ms.
// Runs against the built @homeflow/ui preview pages (packages/ui/preview/dist), served on :5180
// by the second `webServer` entry in playwright.config.ts — hence the local baseURL override
// below instead of the app's :5173.
test.use({ baseURL: "http://localhost:5180" });

const PREVIEW_PAGES = [
  "brand",
  "type",
  "colors",
  "spacing",
  "elevation",
  "motion",
  "forms",
  "buttons",
  "data-display",
  "navigation",
  "feedback",
  "overlays",
];

test.describe("Design system — fonts", () => {
  test("self-hosted Jost and Geist Sans actually load (not just declared)", async ({ page }) => {
    await page.goto("/type.html");
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => ({
      jost: document.fonts.check('600 16px "Jost"'),
      geistSans: document.fonts.check('400 16px "Geist Sans"'),
    }));
    // `document.fonts.check` only returns true once the browser has actually resolved and
    // fetched the face — a 404'd woff2 or a missing @font-face would fail this even though the
    // CSS still *declares* the family name, which is why this is checked separately from the
    // computed-style assertions below.
    expect(loaded.jost).toBe(true);
    expect(loaded.geistSans).toBe(true);
  });

  test("h1 computed font-family is Jost, body is Geist Sans — no Segoe UI/Roboto fallback", async ({
    page,
  }) => {
    await page.goto("/type.html");
    const h1Font = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

    // The declared stack keeps "Segoe UI"/Arial as later, metric-matched fallbacks (fonts.css) —
    // that's intentional, so the regression this guards against (spec 32 "Measured starting
    // point": no webfont, Windows rendered body text in Segoe UI at 17px) is "first family in the
    // stack", not "absent from the stack anywhere".
    expect(h1Font).toMatch(/^"?Jost"?/);
    expect(bodyFont).toMatch(/^"?Geist Sans"?/);
  });
});

test.describe("Design system — accessibility (axe)", () => {
  for (const slug of PREVIEW_PAGES) {
    test(`${slug}.html has 0 serious/critical violations`, async ({ page }) => {
      await page.goto(`/${slug}.html`);
      // motion.html's list-stagger demo starts its items at opacity:0 and
      // animates in over <=440ms (40ms/item, capped at 400ms, +the item's own
      // transition) — scanning mid-fade makes axe flag the momentarily
      // near-invisible text as a color-contrast failure. Wait for it to settle.
      if (slug === "motion") await page.waitForTimeout(600);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});

test.describe("Design system — reduced motion", () => {
  test("prefers-reduced-motion collapses --duration-* tokens to <= 120ms", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/motion.html");
    const durations = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        micro: cs.getPropertyValue("--duration-micro").trim(),
        panel: cs.getPropertyValue("--duration-panel").trim(),
        page: cs.getPropertyValue("--duration-page").trim(),
      };
    });
    for (const [name, raw] of Object.entries(durations)) {
      // Chromium serializes a computed <time> custom property in seconds (".12s"), not the
      // "120ms" literal from tokens.css — normalize by suffix rather than assuming one unit.
      expect(raw, name).toMatch(/^[\d.]+m?s$/);
      const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
      expect(ms, `${name} = ${raw}`).toBeLessThanOrEqual(120);
    }
  });
});
