# Foundation · Design Language

HomeFlow's UI follows an **Apple-inspired, homely** system: clean, calm, neutral, with subtle black-and-white surfaces, restrained colour, and soft **filled ("covered") buttons**. It draws structure from Apple's Human Interface Guidelines — SF Pro type, adaptive system colours, capsule buttons, 44pt targets, hairline separators — but stays *warm* so a family buying a home feels cared for, not processed. **No glassmorphism / Liquid Glass** — surfaces are solid with hairline borders and gentle shadows.

> **The feeling:** opening HomeFlow should feel like a beautifully made Apple app that happens to be about *your home* — quiet, precise, and reassuring. Clarity over decoration. One clear thing per view. Warmth comes from photography, generous whitespace, and human language — not loud colour.

Every role UI inherits these tokens; role `UI/UX` sections apply them and never redefine them.

---

## 1. Principles (Apple-homely)

| Principle | Consequence |
|---|---|
| Deference | The content (the home, the money, the milestone) is the hero. Chrome recedes. |
| Clarity | Legible type, ample spacing, one primary action per screen. |
| Depth without glass | Layering via solid surfaces, hairline separators, and soft shadows — **not** blur/translucency. |
| Restraint in colour | Neutral black/white/grey base; colour used only to carry meaning (status, selection, one accent). |
| Warmth | Real home photography, rounded forms, and plain human copy keep it homely, not clinical. |
| Consistency | Same components, spacing, and motion across customer and workspace skins. |

---

## 2. Two skins, one system

| | **My Pranava Home** (customer) | **Workspace** (internal roles) |
|---|---|---|
| Feel | Serene consumer app — big type, lots of air, photo-forward | Efficient but calm; denser, still spacious |
| Density | One task per view | Scannable lists + right-hand context |
| Colour | Neutral + subtle warm undertone + one accent | Neutral; status colour where it aids decisions |
| Shared | SF Pro, capsule buttons, hairline separators, radii, motion, dark mode, a11y | |

Both skins use the identical token set below; the customer skin simply dials up spacing, type size, and imagery.

---

## 3. Design tokens

Ship as CSS variables + a TypeScript theme. **Light and dark are both first-class** (Apple parity). Names are canonical.

### 3.1 Colour — neutral, adaptive, subtly warm

Base is Apple's system-grey family with a **hair of warmth** (backgrounds lean a touch warm so white doesn't feel clinical). Text is near-black, never pure `#000`.

**Light mode**
```
--hf-bg:            #F6F5F3   /* app background — warm-neutral (Apple systemGroupedBackground, warmed) */
--hf-bg-secondary:  #FFFFFF   /* cards, sheets */
--hf-bg-tertiary:   #F2F1EF   /* insets, grouped rows */
--hf-label:         #1C1C1E   /* primary text (Apple label) */
--hf-label-2:       rgba(60,60,67,0.60)  /* secondary text */
--hf-label-3:       rgba(60,60,67,0.30)  /* tertiary / placeholder */
--hf-separator:     rgba(60,60,67,0.18)  /* hairline (0.5–1px) */
--hf-fill:          rgba(120,120,128,0.12) /* subtle control fill */
--hf-gray:  #8E8E93  --hf-gray2:#AEAEB2  --hf-gray3:#C7C7CC
--hf-gray4: #D1D1D6  --hf-gray5:#E5E5EA  --hf-gray6:#F2F2F7
```

**Dark mode**
```
--hf-bg:            #000000
--hf-bg-secondary:  #1C1C1E
--hf-bg-tertiary:   #2C2C2E
--hf-label:         #FFFFFF
--hf-label-2:       rgba(235,235,245,0.60)
--hf-label-3:       rgba(235,235,245,0.30)
--hf-separator:     rgba(84,84,88,0.55)
--hf-fill:          rgba(120,120,128,0.24)
```

**Accent & semantic** — muted, meaning-only. Colour never sole signal (always icon + label).
```
--hf-accent:        #0A6CFF   /* one calm accent — selection, links, key CTA. Configurable per brand. */
--hf-on-track:      #2FA45A   /* softened system green */
--hf-due:           #C98A2B   /* honey-amber (softened orange) */
--hf-at-risk:       #C7692F   /* warm clay-amber */
--hf-overdue:       #C0392B   /* softened red — urgent, not neon */
--hf-info:          #5E7A8C   /* dusty blue */
```
Rules: **no pure `#000000` text; no neon.** Status colours are desaturated for calm. Gradients are avoided (flat Apple surfaces).

### 3.2 Typography — SF Pro + Dynamic Type

```
--hf-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
           "Inter", system-ui, sans-serif;      /* SF on Apple; Inter fallback on web */
--hf-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", monospace;  /* ids, amounts */
```

Apple Dynamic Type scale (pt → rem at 16=1rem). One family, weight + size carry hierarchy — **no separate serif display** (Apple uses one neutral typeface).

| Style | Size | Weight |
|---|---|---|
| Large Title | 34 | 700 |
| Title 1 / 2 / 3 | 28 / 22 / 20 | 600 |
| Headline | 17 | 600 |
| Body | 17 | 400 |
| Callout / Subhead | 16 / 15 | 400 |
| Footnote | 13 | 400 |
| Caption | 12 | 400 |

Customer "moments that matter" use **Large Title / Title 1** for warmth and presence (not a serif). Financial tables use `--hf-font-mono` tabular figures.

### 3.3 Shape, space, elevation — soft, roomy, flat

```
--hf-radius-sm: 8px
--hf-radius-md: 12px     /* default card/control radius (continuous/superellipse corners) */
--hf-radius-lg: 20px     /* sheets, hero cards */
--hf-radius-capsule: 999px  /* buttons, chips */
--hf-space: 4px grid → 4 8 12 16 20 24 32 44 64
--hf-hairline: 0.5px solid var(--hf-separator)
--hf-shadow-1: 0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.05)  /* resting card */
--hf-shadow-2: 0 4px 16px rgba(0,0,0,0.08)                             /* raised / sheet */
```

Corners are **continuous** (iOS squircle feel). Separation prefers **hairlines + whitespace** over boxes and heavy borders. Shadows are soft and sparing; most surfaces sit flat on a grouped background.

### 3.4 Buttons — the "covered" (filled) family

Apple-style hierarchy, all min-height **44px**, capsule or 12px radius, no glass:

| Variant | Look | Use |
|---|---|---|
| **Filled (primary)** | Solid near-black (`--hf-label`) fill, white label — the "covered" button | The one primary action per view |
| **Accent-filled** | Solid `--hf-accent` fill, white label | Key confirm (Pay, Book, Approve) |
| **Tinted (secondary)** | `--hf-fill` light shell + accent/label text, hairline border | Secondary actions |
| **Gray (tertiary)** | `--hf-gray6` shell, label text | Low-emphasis |
| **Plain (text)** | No fill, accent label | Links, inline actions |

States use subtle opacity/fill shifts (pressed = slightly darker fill), never harsh outlines. Focus ring: 2px `--hf-accent` at 40% + offset.

### 3.5 Motion — quiet Apple springs

```
--hf-ease: cubic-bezier(0.32, 0.72, 0, 1)   /* iOS-like ease */
--hf-spring: 320ms var(--hf-ease)
--hf-dur-fast: 160ms   --hf-dur: 240ms
```
Gentle, physical, brief. Sheets slide, rows settle, progress reveals softly. **No** bounce/confetti except a single tasteful "handover day" moment. Respect `prefers-reduced-motion`.

---

## 4. Imagery — the homely core

Even in a minimal Apple frame, **photography carries the warmth.** Images are first-class, presented clean.

| Where | Treatment |
|---|---|
| Customer home header | Full-bleed, rounded (radius-lg) hero of *their* unit/project; generous whitespace around it. |
| Progress updates | Real milestone photos, edge-to-edge cards, captioned + dated. Never stock. |
| Unit cards (sales) | Unit photo with quiet status chips overlaid; lots of air. |
| Empty states | Simple, warm line illustrations (home, keys, plant) — Apple-clean, not gray "no data". |
| Avatars | Real RM/staff photos to humanize. |
| Evidence (QA/snag) | Clean photo grids; before/after; tap to zoom. |
| Home Passport | Product/appliance imagery on tidy cards. |

Rules: alt text on every meaningful image; blur-up placeholders (neutral, not gray blocks); art-directed responsive crops; a missing image falls back to a clean illustrated placeholder, never a broken icon.

---

## 5. Core components (shared library, `packages/ui`)

Built once; both skins consume. All map to the tokens above.

| Component | Apple-homely intent |
|---|---|
| `Card` | Solid `--hf-bg-secondary`, radius-md, hairline or shadow-1. Default container. |
| `ListRow` | Inset grouped row, hairline separators, chevron affordance — the workhorse of dense views. |
| `Button` | The filled/tinted/gray/plain family (§3.4). |
| `StatusChip` | Capsule, `--hf-fill` shell, icon + label + muted semantic colour. |
| `GateChip` | Specialized chip: OPEN/CLOSING/CONDITIONAL/EXCEPTION/HARD_CLOSED with distinct SF-Symbol-style icon + tooltip explaining *why*. |
| `ScoreDial` | Explainable score — value, trend, top-3 drivers on expand, confidence. Never a bare badge. |
| `Timeline` | Journey — quiet milestone nodes, photos at moments; plan/forecast/actual toggles (internal) or simple milestones (customer). |
| `ActionCard` | A Universal Action: title, why-now, owner avatar, SLA/plan status, one-click actions. |
| `PhotoGrid` / `BeforeAfter` | Evidence. |
| `MoneyFigure` | Tabular mono, INR (₹, lakh/crore), risk-tinted. |
| `PersonRow` | Avatar + name + role — humanizes lists. |
| `EmptyState` | Warm illustration + one helpful next step. |
| `MomentCard` | Customer Large-Title hero for the 7 "moments that matter." |
| `Sheet` / `Modal` | Solid sheet, radius-lg, slide-up; no glass. |

Icons: an **SF-Symbols-style** line set (e.g. SF Symbols on Apple, a clean equivalent like Lucide on web). Targets ≥44px; visible accent focus ring; full keyboard nav.

---

## 6. Layout patterns

- **Customer:** single calm column, wide margins, one primary thing per view; simple bottom tab bar ≤5 items (Journey · My Home · Payments · Documents · Requests). Reads like a first-class iOS app.
- **Internal:** left sidebar (role queues) + main list/detail + optional right context panel (the twin in focus). Grouped, inset lists; hairline separators; roomy. **Project selector** top-left when the user has >1 project.
- **My Day** is every employee's landing — ranked `ActionCard`s, not a module menu.
- **Control Tower** shows **five** intervention cards, never chart walls.

---

## 7. Voice & copy

| Context | Tone |
|---|---|
| Customer | Warm, plain, reassuring. "Your kitchen wiring is being finished this week." No jargon, no internal terms (no "gate", "SLA", "twin"). |
| Internal | Direct, decision-oriented. "Overdue ₹12L · bank release Fri · blocks registration." |
| Errors | Human, with the fix. Never raw codes to customers. |
| Empty | Encouraging, forward-looking. |

Separate copy sets per skin enforce that internal vocabulary never reaches customers.

---

## 8. Accessibility & quality bar

- WCAG 2.1 AA (4.5:1 text, 3:1 large) — token palette is tuned for it in light **and** dark.
- **Dark mode** fully supported (Apple parity).
- Status never by colour alone (icon + label always).
- Dynamic Type: layouts reflow as text scales.
- 44px min targets; visible focus; full keyboard nav; `prefers-reduced-motion`.
- Responsive: customer skin mobile-first; workspace desktop-first, usable to tablet.
- Localization-ready; ₹ + Indian number formatting.

---

## 9. What to avoid

- **Glassmorphism / Liquid Glass, blur-heavy translucency** — explicitly out.
- Pure `#000`/neon colour; loud gradients; hard 1px gray boxes everywhere.
- Serif display type (this system is single-typeface, SF Pro).
- Dense tables with no whitespace, avatars, or imagery.
- Gamified motion/confetti (except the one handover moment).
- Generic gray "no data" states.
- Exposing internal jargon to customers.

If a screen looks like a generic glassy dashboard **or** a cold enterprise grid, it has failed this spec. The target is *calm, warm, Apple-clean, unmistakably about a home.*
