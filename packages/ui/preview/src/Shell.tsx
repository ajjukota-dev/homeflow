import * as React from "react";

const NAV = [
  { href: "brand.html", label: "Brand" },
  { href: "type.html", label: "Type" },
  { href: "colors.html", label: "Colors" },
  { href: "spacing.html", label: "Spacing" },
  { href: "elevation.html", label: "Elevation" },
  { href: "motion.html", label: "Motion" },
  { href: "forms.html", label: "Forms" },
  { href: "buttons.html", label: "Buttons" },
  { href: "data-display.html", label: "Data display" },
  { href: "navigation.html", label: "Navigation" },
  { href: "feedback.html", label: "Feedback" },
  { href: "overlays.html", label: "Overlays" },
];

/** Shared chrome for every preview page: title, cross-page nav, and a `Section` helper so each
 * page reads as a catalogue of variants/states rather than a demo screen. */
export function PreviewPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-workspace px-6 py-8">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-4">
        <h1 className="font-heading text-ws-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-ws-xs text-fg-muted">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-fg hover:underline">
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="flex flex-col gap-10">{children}</main>
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  // Deliberately `items-stretch` (the flex default): most section bodies (Table, PageHeader,
  // swatch grids) want the full section width for free. A bare trigger control that should NOT
  // stretch — especially one whose root is a Radix `Root` with no DOM wrapper of its own — needs
  // `self-start` added at the call site instead of changing this shared default.
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-ws-lg font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-1 text-ws-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-card border border-line"
        style={{ background: `var(${varName})` }}
        aria-hidden
      />
      <div>
        <p className="text-ws-sm font-medium text-fg">{name}</p>
        <p className="hf-tnum text-ws-xs text-fg-muted">{varName}</p>
      </div>
    </div>
  );
}
