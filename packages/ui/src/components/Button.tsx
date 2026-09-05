/** The one button (technical/09 §6). Replaces v1's shadcn `button.jsx` as pages are ported. */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block = false, loading = false, disabled, children, className, ...rest },
  ref,
) {
  const classes = [
    "hf-btn",
    `hf-btn--${variant}`,
    size === "sm" ? "hf-btn--sm" : "",
    block ? "hf-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} type="button" className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && <Loader2 aria-hidden className="hf-spin" />}
      {children}
    </button>
  );
});
