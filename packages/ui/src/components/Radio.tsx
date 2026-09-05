import * as React from "react";
import * as RadixRadioGroup from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";

export const RadioGroup = RadixRadioGroup.Root;

export interface RadioItemProps extends RadixRadioGroup.RadioGroupItemProps {
  label: string;
}

/** Radio — one item of a RadioGroup (Radix). Always used with a `RadioGroup` root. */
export const RadioItem = React.forwardRef<HTMLButtonElement, RadioItemProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = React.useId();
    const itemId = id ?? generatedId;
    return (
      <div className="inline-flex items-center gap-2">
        <RadixRadioGroup.Item
          ref={ref}
          id={itemId}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface",
            "transition-colors duration-micro ease-ds-out hover:border-fg-subtle",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "data-[state=checked]:border-accent",
            "disabled:cursor-not-allowed disabled:opacity-40",
            className,
          )}
          {...props}
        >
          <RadixRadioGroup.Indicator className="size-2.5 rounded-full bg-accent" />
        </RadixRadioGroup.Item>
        <label htmlFor={itemId} className="text-ws-body text-fg">
          {label}
        </label>
      </div>
    );
  },
);
RadioItem.displayName = "RadioItem";
