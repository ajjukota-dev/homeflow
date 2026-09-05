/** Money always renders through here: compact on screen, exact in the tooltip. */
import { inr, inrFull } from "../format";

export interface MoneyProps {
  value: number | string | null | undefined;
  /** false spells the amount out in full: ₹4,75,00,000. */
  compact?: boolean;
}

export function Money({ value, compact = true }: MoneyProps) {
  const exact = inrFull(value);
  return (
    <span className="hf-money" title={compact ? exact : undefined}>
      {compact ? inr(value) : exact}
    </span>
  );
}
