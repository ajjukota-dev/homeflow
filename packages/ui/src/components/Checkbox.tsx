import * as React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface CheckboxProps extends RadixCheckbox.CheckboxProps {
  label?: string;
}

/** Checkbox — Radix primitive for correct keyboard/ARIA behaviour, HomeFlow token styling. */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = React.useId();
    const checkboxId = id ?? generatedId;
    const control = (
      <RadixCheckbox.Root
        ref={ref}
        id={checkboxId}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded border border-line bg-surface",
          "transition-colors duration-micro ease-ds-out hover:border-fg-subtle",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
          "disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check className="size-3.5 text-accent-fg" aria-hidden />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
    );
    if (!label) return control;
    return (
      <div className="inline-flex items-center gap-2">
        {control}
        <label htmlFor={checkboxId} className="text-ws-body text-fg">
          {label}
        </label>
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";
