import * as React from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  status?: "error" | "success";
}

const STATUS_CLASS = {
  error: "border-danger focus-visible:outline-danger",
  success: "border-ok focus-visible:outline-ok",
} as const;

/** Textarea — multi-line text, same token contract as Input. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, status, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-control border border-line bg-surface px-3 py-2 text-ws-body text-fg",
        "placeholder:text-fg-subtle transition-colors duration-micro ease-ds-out",
        "hover:border-fg-subtle",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-subtle disabled:opacity-70",
        status ? STATUS_CLASS[status] : "",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
