import * as React from "react";
import { cn } from "../lib/cn";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string;
  size?: "sm" | "md";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Avatar — photo or initials fallback, sized for lists (sm) or headers (md). */
export function Avatar({ name, src, size = "md", className, ...props }: AvatarProps) {
  const dims = size === "sm" ? "size-7 text-ws-xs" : "size-10 text-ws-sm";
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(dims, "rounded-full object-cover", className)}
        {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        dims,
        "inline-flex items-center justify-center rounded-full bg-accent-soft font-medium text-accent-soft-fg",
        className,
      )}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
