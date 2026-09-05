import * as React from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

export const TooltipProvider = RadixTooltip.Provider;

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: RadixTooltip.TooltipContentProps["side"];
}

/** Tooltip — hover/focus label for icon-only controls. Wrap the app root once in `TooltipProvider`. */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn("z-50 rounded-control bg-fg px-2.5 py-1.5 text-ws-xs text-bg shadow-panel")}
        >
          {content}
          <RadixTooltip.Arrow className="fill-fg" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
