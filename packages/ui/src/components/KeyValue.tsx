import * as React from "react";
import { cn } from "../lib/cn";

export interface KeyValueItem {
  key: string;
  value: React.ReactNode;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  className?: string;
}

/** KeyValue — a label/value list (unit details, commitment terms). Tabular figures on values so
 * amounts and codes line up. */
export function KeyValue({ items, className }: KeyValueProps) {
  return (
    <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2", className)}>
      {items.map((item) => (
        <React.Fragment key={item.key}>
          <dt className="text-ws-sm text-fg-muted">{item.key}</dt>
          <dd className="hf-tnum text-ws-body text-fg">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
