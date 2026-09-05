import { cn } from "../lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
}

/** iOS-style segmented control. Accessible radiogroup; keyboard + screen-reader friendly. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-0.5 rounded-lg bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-9 rounded-[7px] px-3.5 text-subhead font-medium transition-colors",
              active
                ? "bg-surface text-fg shadow-card"
                : "text-fg-muted hover:text-fg"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
