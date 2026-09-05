import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

/** Button — spec docs/specs/32-design-system.md primitives list.
 * Variants: primary (accent, the one place orange owns a filled surface) / secondary / ghost /
 * danger. Sizes sm/md. `iconOnly` drops label padding for a square icon button — prefer
 * `IconButton` for a labelled-by-tooltip icon trigger.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control font-sans font-medium " +
    "transition-colors duration-micro ease-ds-out disabled:pointer-events-none disabled:opacity-40 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent/80",
        secondary: "bg-surface text-fg border border-line hover:bg-surface-raised active:bg-line/40",
        ghost: "bg-transparent text-fg hover:bg-surface-raised active:bg-line/40",
        danger: "bg-danger text-white hover:bg-danger/90 active:bg-danger/80",
      },
      size: {
        sm: "h-8 px-3 text-ws-sm",
        md: "h-10 px-4 text-ws-body",
      },
      iconOnly: {
        true: "aspect-square px-0",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", size: "md", iconOnly: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (Radix Slot) instead of a <button>. */
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables interaction. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, iconOnly, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, iconOnly }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";
