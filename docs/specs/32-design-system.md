# 32 — Design system: tokens, type, colour, motion, primitives (both apps)

## Purpose
Amarsh (2026-09-05): "colours or spacing or font or size looks really cheap and bad, and animations are expected." PDF: p25 §20 screen architecture; p32 §27 "no chart-heavy dashboards"; p33 §29 "A customer opens My Pranava Home and understands their journey." CLAUDE.md UI bar (no purple/indigo, no glass, no filler, WCAG AA). Quality references: `~/claude-setup/reference/impeccable/` — read `README.md`, `craft-floor.md`, then `typeset.md`, `colorize.md`, `layout.md`, `animate.md`, `new-work.md` before touching UI (skip every script/CLI step they mention).

Measured starting point: no webfont (Windows renders Segoe UI at 17 px); motion = `animate-pulse` + one spinner; accent `#0a6cff`; cards with border + shadow (ghost card); Tailwind default spacing; two apps each with their own `src/ui`.

## Direction (settled here so agents don't re-decide)
- **Workspace = Operate mode**: dense, calm, high-signal; tables and lists over cards; status by icon + label; one accent used only for the primary action and focus; neutrals do the layout work. Default light; dark designed, not inverted.
- **Portal = Read/Experience mode**: warmer, more generous measure and leading, larger type, serif display for headings, photos of the actual project where available; reassuring, never salesy.
- **Brand (researched 2026-09-05 from the logo file and pranavagroup.com — DYOR per Amarsh):** Pranava Group, tagline "Presenting the Future". Logo: two chevron towers, charcoal + orange, wide-tracked geometric caps (`docs/brand/pranava-group-logo.jpeg` 1577×1600; `logo-pranava.png` 191×166 and `favicon.png` from the site — ask Pranava for the SVG; until then the mark is redrawn as SVG from the JPEG geometry). Colours: **orange `#E74C0A`** (site CSS, 23 uses; logo samples `#E65123`), **ink `#1C1F26`**, charcoal `#424242` (logo type), grey `#6A6A6A`, ground `#F7F8F9`/`#F0F0F0`. Typeface: **Jost** (Google Fonts, variable 100–900) site-wide.
  - **How we use it:** ink/charcoal do the structure; **orange is the accent** — primary button, focus ring, active nav, the logo — and nothing else, so it stays a brand signal, not noise. Status colours therefore avoid orange: ON_TRACK green, DUE_SOON info blue, AT_RISK amber, OVERDUE red (icon + label always). Jost carries **headings, wordmark, portal display**; body/data text uses **Geist Sans** (Jost's geometric letterforms read poorly at 13–14 px in dense tables; Geist has tabular figures). Newsreader is dropped — brand continuity beats my serif idea. Dark mode: orange at `#FF6A3D` for contrast on `#111214` surfaces.

## Data / artefacts
| Piece | Choice **[ours]** |
|---|---|
| Package | `packages/ui` — the one shared consumer-justified package: `tokens.css`, fonts, primitives, `motion.ts`, preview pages. Both apps import from it; `apps/*/src/ui` are deleted. (Reverses the earlier "no packages/ extraction" cut: a shared design system is exactly the third consumer.) |
| Typefaces (self-hosted woff2, `font-display: swap`, subset latin + ₹) | Display/headings/wordmark: **Jost** (brand face, variable, OFL) — h1/h2 in both apps, weights 500–600, tracking −0.01em; body/UI/data: **Geist Sans** (variable, OFL) with `font-feature-settings: "tnum"` on figures; codes/IDs only: **Geist Mono**. No system-font fallback as the *intended* face; fallbacks metric-matched via `size-adjust`. |
| Colour (brand-derived) | `--accent: #E74C0A` (`#FF6A3D` dark), `--accent-fg: #fff`, `--accent-soft: #FDEDE6`; `--fg: #1C1F26`, `--fg-muted: #6A6A6A`, `--fg-subtle: #9A9A9A`; `--bg: #F7F8F9`, `--surface: #fff`, `--surface-raised: #FCFCFC`, `--line: #E6E6E6`; status `--ok #1E7F4F`, `--info #2B6CB0`, `--warn #B7791F`, `--danger #C0392B` with `-soft` tints meeting 4.5:1 for their `-fg`. Dark: `--bg #111214`, `--surface #1A1B1E`, `--surface-raised #22242A`, `--line #2E3138`, `--fg #F2F2F0`. |
| Type scale | Workspace: 12 / 13 / 14 (body) / 16 / 20 / 24 / 30, line-height 1.45–1.5 body, 1.15–1.2 headings, tracking −0.01 to −0.02em on ≥ 20 px. Portal: 14 / 16 (body) / 18 / 22 / 28 / 36 / 48, body measure 60–70ch. Obvious steps; no 15/17 px in-betweens. |
| Spacing | 4 px base: 4, 8, 12, 16, 24, 32, 48, 64. Tight within groups (4–8), generous between (24–48); more above headings than below. Container widths 1280 (workspace), 880 (portal reading). |
| Colour tokens (semantic names) | `--bg`, `--surface`, `--surface-raised`, `--line`, `--fg`, `--fg-muted`, `--fg-subtle`, `--accent`, `--accent-fg`, `--accent-soft`; status `--ok`, `--info`, `--warn`, `--danger` each with `-soft` and `-fg`. Values in the brand row above; dark elevation by lighter surfaces, not shadows. |
| Elevation | Declare once: hairline border **or** shadow. Cards: `--surface` + 1 px `--line`, radius 12; popovers/drawers: shadow with offset + soft blur (`0 12px 32px -8px rgb(0 0 0 / .18)`), no border. Never both. Pills only for chips. |
| Motion | `motion` (framer-motion v12, React) for drawers, lists, layout transitions; CSS for micro-interactions. Easing `cubic-bezier(0.16, 1, 0.3, 1)` (exponential out), durations 160 ms (micro) / 240 ms (panel) / 400 ms (page). **One authored moment per surface** (see Rules 6). `prefers-reduced-motion` → transitions collapse to opacity ≤ 120 ms. |
| Icons | lucide, 16/20 px, stroke 1.75; status always icon + label. |
| Density | Workspace tables: `compact` (32 px rows) default, `comfortable` (40 px) toggle persisted per user. |

## Primitives (`packages/ui/src/`), each with all states (default, hover, focus-visible, active, disabled, loading, error, success) and a preview page
`Button` (primary / secondary / ghost / danger; sm / md; icon-only) · `IconButton` · `Input`, `Textarea`, `Select`, `Combobox` (searchable), `DatePicker` (IST), `MoneyInput` (Indian grouping, ₹) · `Checkbox`, `Radio`, `Switch`, `Segmented` · `Field` (label, hint, error, required) · `Table` (sticky header, density, sortable, row selection, empty/loading/error, virtualised ≥ 200 rows) · `Tabs` · `Drawer` (right, 480/640) · `Dialog` (only for protected-focus tasks) · `Popover`, `Tooltip` · `Toast` · `StatusChip` (icon + label, five statuses + gate five-state set) · `Badge` · `ScoreCard` (value, trend, 3 drivers, confidence, actions — 14 contract; not a hero-metric block) · `Timeline` (four-date rail) · `Stepper` (status flows) · `EmptyState` (message + one action) · `Skeleton` · `Breadcrumb` · `PageHeader` (one h1, actions right) · `Project360Header` slot · `KeyValue` list · `Avatar` · `FileDrop` + `CameraCapture` · `SignaturePad`.

## Rules
1. No raw colour, size, radius or shadow literals in app code — Tailwind classes map to tokens only; ESLint rule (`no-restricted-syntax` on hex/px in className strings) fails CI.
2. Contrast: body ≥ 4.5:1, large ≥ 3:1, controls/focus ≥ 3:1 — automated with axe in Playwright on every preview page and every app screen in the E2E suite.
3. One `h1` per page; heading levels never skipped; no eyebrow/kicker labels; no gradient text; no glass; no side-stripe borders; no identical card grids as page structure; nested cards never.
4. Every list/table has loading (skeleton shaped like the content), empty (message + action), error (problem + recovery) states. Every form control has the seven states.
5. Copy is the product's language: buttons name the action ("Record receipt", not "Submit"); errors name the problem and the fix.
6. Authored motion moments (the only ones; everything else is 160 ms micro): My Day sections settle in with a 40 ms stagger on first load; Action drawer slides from right with content fading 60 ms later; gate/status chips morph colour + icon on state change; skeleton → content crossfade; portal journey rail draws the completed segment on first view. Nothing animates on hover except the container's feedback (never images).
7. Responsive at 375 / 768 / 1024 / 1440 with real seeded content (long names, ₹1,23,45,678.00, 200-row tables); text containers never fixed width.
8. Dark mode designed per token (elevation via surface steps), verified with the same contrast checks.
9. Previews: every primitive and every token group has a preview HTML in `packages/ui/preview/` with a first-line `<!-- @dsCard group="…" -->` marker so `/design-sync` publishes them to the Claude Design project for Amarsh's review; feedback comes back as token/primitive changes, one component at a time.
10. Migration: apps switch screen by screen (page files import from `@homeflow/ui`); a screen is "redesigned" only after its Playwright screenshots at 3 breakpoints were reviewed and its axe pass is clean. Old `src/ui` deleted when the last import is gone.

## Process with Claude Design
1. Done 2026-09-05: `/design-login` authorised; project **"Pranava HomeFlow"** created, `projectId a9dbd115-c63e-4358-a8fe-a57754659c37`. 2. I build `packages/ui` tokens + first 8 primitives + preview pages locally, run the E2E screenshot + axe pass, then `/design-sync` them to that project. 3. Amarsh reviews in claude.ai/design; comments → I change tokens/primitives → re-sync. 4. Remaining primitives and the app screens follow the same loop, bounded: build fully → inspect once (desktop + mobile together) → fix in one batch → at most one more round.

## Acceptance
- Fonts load (Playwright: computed `font-family` is Geist on body text and Jost on h1/h2 in both apps; no Segoe/Roboto) at 3 breakpoints.
- axe: 0 serious/critical on every preview page and every app screen.
- Token lint: CI fails on a planted `#0a6cff` in a component.
- Motion: reduced-motion test shows ≤ 120 ms transitions; My Day stagger present otherwise.
- Screenshot review checklist (craft-floor "Verify") recorded in the PR for each migrated screen.
- Amarsh's review in Claude Design: tokens + primitives approved before app screens migrate (gate R1 → R2).

## Depends on / Feeds
Depends on 03 (CI). Feeds every screen in every spec; blocks R1 demo hardening (demo shows the new design).

## Files
`packages/ui/**`, `apps/workspace/src/ui/**` (delete), `apps/my-pranava-home/src/ui/**` (delete), `apps/*/tailwind.config.ts`, `apps/*/src/index.css`, `apps/*/index.html`, `.eslintrc*` (token rule), `apps/*/e2e/design.spec.ts` (fonts, axe, reduced motion).

## Not in this feature
Marketing pages; illustrations; brand creation (placeholder tokens until Pranava supplies assets).
