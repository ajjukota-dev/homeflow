import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "../lib/cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

export function PopoverContent({ className, sideOffset = 6, ...props }: RadixPopover.PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        className={cn(
          "z-40 min-w-48 rounded-card bg-surface p-3 shadow-panel focus-visible:outline-none",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
