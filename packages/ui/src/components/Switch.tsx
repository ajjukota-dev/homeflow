import * as React from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "../lib/cn";

export interface SwitchProps extends RadixSwitch.SwitchProps {
  label?: string;
}

/** Switch — on/off toggle (Radix), used for persisted density/preference controls. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = React.useId();
    const switchId = id ?? generatedId;
    const control = (
      <RadixSwitch.Root
        ref={ref}
        id={switchId}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-pill bg-line transition-colors duration-micro ease-ds-out",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        {...props}
      >
        <RadixSwitch.Thumb
          className={cn(
            "block size-4.5 translate-x-1 rounded-full bg-white shadow-panel",
            "transition-transform duration-micro ease-ds-out data-[state=checked]:translate-x-5",
          )}
        />
      </RadixSwitch.Root>
    );
    if (!label) return control;
    return (
      <div className="inline-flex items-center gap-2">
        {control}
        <label htmlFor={switchId} className="text-ws-body text-fg">
          {label}
        </label>
      </div>
    );
  },
);
Switch.displayName = "Switch";
