/**
 * Status is never colour alone: every chip pairs an icon with a text label
 * (CLAUDE.md accessibility bar, technical/09 §6).
 */
import type { ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock } from "lucide-react";

export type Tone = "ok" | "warn" | "risk" | "blocked" | "neutral";

const ICONS: Record<Tone, ReactNode> = {
  ok: <CheckCircle2 aria-hidden />,
  warn: <Clock aria-hidden />,
  risk: <AlertTriangle aria-hidden />,
  blocked: <Ban aria-hidden />,
  neutral: <Circle aria-hidden />,
};

export interface StatusChipProps {
  tone?: Tone;
  label: string;
  title?: string;
  icon?: ReactNode;
}

export function StatusChip({ tone = "neutral", label, title, icon }: StatusChipProps) {
  return (
    <span className={`hf-chip hf-chip--${tone}`} title={title} data-testid="status-chip">
      {icon ?? ICONS[tone]}
      {label}
    </span>
  );
}
