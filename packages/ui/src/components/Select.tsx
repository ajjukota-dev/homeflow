import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export const Select = RadixSelect.Root;

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectTriggerProps extends RadixSelect.SelectTriggerProps {
  placeholder?: string;
}

export function SelectTrigger({ className, placeholder, ...props }: SelectTriggerProps) {
  return (
    <RadixSelect.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3",
        "text-ws-body text-fg transition-colors duration-micro ease-ds-out hover:border-fg-subtle",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-subtle disabled:opacity-70",
        "data-[state=open]:border-accent",
        className,
      )}
      {...props}
    >
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon>
        <ChevronDown className="size-4 text-fg-muted" aria-hidden />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectOptions({ options }: { options: SelectOption[] }) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        position="popper"
        sideOffset={4}
        className="z-50 max-h-72 overflow-auto rounded-card border border-line bg-surface shadow-panel"
      >
        <RadixSelect.Viewport className="p-1">
          {options.map((opt) => (
            <RadixSelect.Item
              key={opt.value}
              value={opt.value}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-ws-body text-fg",
                "outline-none data-[highlighted]:bg-surface-raised",
              )}
            >
              <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              <RadixSelect.ItemIndicator>
                <Check className="size-3.5 text-accent" aria-hidden />
              </RadixSelect.ItemIndicator>
            </RadixSelect.Item>
          ))}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}
