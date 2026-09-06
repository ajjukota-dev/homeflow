import * as React from "react";
import { cn } from "../lib/cn";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Rendered right-aligned next to the title (spec: "one h1, actions right"). */
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}

/** PageHeader — the one `h1` a page gets. Never used twice on the same page. */
export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-ws-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
          {description ? <p className="mt-1 text-ws-body text-fg-muted">{description}</p> : null}
        </div>
        {/* flex-wrap, no shrink-0: found live-verifying 06-timeline-sla-engine.md's Journey
            Timeline at 375px — shrink-0 forces this wrapper to its max-content width regardless
            of wrapping ability, so multi-button actions (Segmented + 3 buttons) overflowed the
            viewport instead of wrapping onto a second line. */}
        {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
