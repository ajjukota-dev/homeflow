// 28-360-views.md Files list. `@homeflow/ui`'s own Breadcrumb (packages/ui/src/components/
// Breadcrumb.tsx) renders `<a href>` links, which would full-page-reload this app (App.tsx has
// no real router — Workspace.tsx navigates via in-memory state). This thin wrapper keeps that
// component's exact visual language but swaps `href` for an in-app `onClick`, so "Portfolio ›
// Project › Tower › Unit" (rule 6) can drive the same overlay navigation as everywhere else.
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

export interface BreadcrumbClickItem { label: string; onClick?: () => void }

export function Breadcrumb({ items, className }: { items: BreadcrumbClickItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex flex-wrap items-center gap-1.5 text-footnote", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" aria-hidden /> : null}
            {item.onClick && !isLast ? (
              <button onClick={item.onClick} className="text-fg-muted hover:text-fg hover:underline">
                {item.label}
              </button>
            ) : (
              <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-medium text-fg" : "text-fg-muted"}>
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
