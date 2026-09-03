import { cn } from "../lib/utils";

type Risk = "none" | "due" | "overdue";

/** INR money in tabular mono with lakh/crore grouping, optionally risk-tinted. */
export function MoneyFigure({ amount, risk = "none" }: { amount: number; risk?: Risk }) {
  return (
    <span
      className={cn(
        "font-mono font-semibold tabular-nums",
        risk === "overdue" && "text-overdue",
        risk === "due" && "text-due"
      )}
    >
      {formatINR(amount)}
    </span>
  );
}

/** Indian grouping: ₹12,34,567. */
export function formatINR(n: number): string {
  const s = Math.round(n).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `₹${grouped}`;
}
