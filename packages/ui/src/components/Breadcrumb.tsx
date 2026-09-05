import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

/** Breadcrumb — trail above `PageHeader`. The last item is the current page (not a link). */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1.5 text-ws-sm", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={item.label}>
            {i > 0 ? <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden /> : null}
            {item.href && !isLast ? (
              <a href={item.href} className="text-fg-muted hover:text-fg hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-fg" : "text-fg-muted"}>
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
