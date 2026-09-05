import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

// Apple-homely button family (design-language §3.4). "solid" is the filled/covered primary.
const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        solid: "bg-fg text-surface hover:opacity-90 active:opacity-80",
        accent: "bg-accent text-accent-fg hover:opacity-90 active:opacity-80",
        tinted: "bg-surface-2 text-accent hover:bg-line active:bg-line",
        outline: "border border-line bg-surface text-fg hover:bg-surface-2",
        ghost: "text-fg hover:bg-surface-2",
        plain: "text-accent hover:underline",
      },
      size: {
        sm: "h-9 px-3.5 text-subhead",
        md: "h-11 px-5 text-subhead",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "solid", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = "Button";
