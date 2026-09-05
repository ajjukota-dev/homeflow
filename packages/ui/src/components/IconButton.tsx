import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "iconOnly"> {
  icon: LucideIcon;
  /** Required — an icon-only control must still announce its action to assistive tech. */
  "aria-label": string;
}

/** IconButton — a square icon-only trigger. Pair with `Tooltip` so sighted users get the label too. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, variant = "ghost", size = "md", ...props }, ref) => (
    <Button ref={ref} variant={variant} size={size} iconOnly {...props}>
      <Icon className={size === "sm" ? "size-4" : "size-5"} aria-hidden />
    </Button>
  ),
);
IconButton.displayName = "IconButton";
