/** HomeFlow shared Tailwind preset — docs/specs/32-design-system.md.
 * Token-mapped theme (colour, spacing, type, radii, shadows, easing/durations) both apps extend.
 * Additive: apps keep their own `theme.extend` on top, so existing screens are unaffected until
 * they migrate to `@homeflow/ui` component classes/tokens.
 * @type {import('tailwindcss').Config}
 */
// `rgb(var(--x-rgb) / <alpha-value>)` (not a plain `var(--x)`) is what lets Tailwind generate
// opacity-modified utilities (`bg-line/70`, `bg-accent/90`, ...) — see tokens.css's file comment.
const withAlpha = (rgbVar) => `rgb(var(${rgbVar}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: withAlpha("--bg-rgb"),
        surface: {
          DEFAULT: withAlpha("--surface-rgb"),
          raised: withAlpha("--surface-raised-rgb"),
        },
        line: withAlpha("--line-rgb"),
        fg: {
          DEFAULT: withAlpha("--fg-rgb"),
          muted: withAlpha("--fg-muted-rgb"),
          subtle: withAlpha("--fg-subtle-rgb"),
        },
        accent: {
          DEFAULT: withAlpha("--accent-rgb"),
          fg: withAlpha("--accent-fg-rgb"),
          soft: withAlpha("--accent-soft-rgb"),
          "soft-fg": withAlpha("--accent-soft-fg-rgb"),
        },
        ok: { DEFAULT: withAlpha("--ok-rgb"), soft: withAlpha("--ok-soft-rgb"), fg: withAlpha("--ok-fg-rgb") },
        info: { DEFAULT: withAlpha("--info-rgb"), soft: withAlpha("--info-soft-rgb"), fg: withAlpha("--info-fg-rgb") },
        warn: { DEFAULT: withAlpha("--warn-rgb"), soft: withAlpha("--warn-soft-rgb"), fg: withAlpha("--warn-fg-rgb") },
        danger: {
          DEFAULT: withAlpha("--danger-rgb"),
          soft: withAlpha("--danger-soft-rgb"),
          fg: withAlpha("--danger-fg-rgb"),
        },
      },
      fontFamily: {
        // Headings/wordmark/portal-display use Jost; body/UI/data uses Geist Sans; codes/IDs use Geist Mono.
        // "* Fallback" entries are the size-adjusted metric-match faces declared in fonts.css.
        heading: ["Jost", "Jost Fallback", "Arial", "sans-serif"],
        sans: ["Geist Sans", "Geist Sans Fallback", "Segoe UI", "Arial", "sans-serif"],
        mono: ["Geist Mono", "Geist Mono Fallback", "ui-monospace", "SF Mono", "monospace"],
      },
      fontSize: {
        // Workspace scale (12/13/14/16/20/24/30), obvious steps, no 15/17px in-betweens.
        "ws-xs": ["0.75rem", { lineHeight: "1.45" }],
        "ws-sm": ["0.8125rem", { lineHeight: "1.45" }],
        "ws-body": ["0.875rem", { lineHeight: "1.5" }],
        "ws-md": ["1rem", { lineHeight: "1.5" }],
        "ws-lg": ["1.25rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        "ws-xl": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "ws-2xl": ["1.875rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        // Portal scale (14/16/18/22/28/36/48), body measure 60-70ch.
        "portal-sm": ["0.875rem", { lineHeight: "1.5" }],
        "portal-body": ["1rem", { lineHeight: "1.6" }],
        "portal-md": ["1.125rem", { lineHeight: "1.5" }],
        "portal-lg": ["1.375rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "portal-xl": ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "portal-2xl": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "portal-3xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      spacing: {
        // 4px base scale, named for the values not commonly already covered by Tailwind's default.
        18: "4.5rem",
      },
      borderRadius: {
        card: "var(--radius-card)",
        control: "var(--radius-control)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
      },
      maxWidth: {
        workspace: "var(--container-workspace)",
        portal: "var(--container-portal)",
      },
      transitionTimingFunction: {
        "ds-out": "var(--ease-out-expo)",
      },
      transitionDuration: {
        micro: "160ms",
        panel: "240ms",
        page: "400ms",
      },
    },
  },
  plugins: [],
};
