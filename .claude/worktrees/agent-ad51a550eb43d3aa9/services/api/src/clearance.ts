// H7 financial clearance — accounts produces, legal/CRM consume (handshakes.md H7).
// Threshold is policy data, never a hard-coded East Crest percentage.

export function financialClearance(input: {
  paid: number;
  consideration: number;
  threshold_pct: number;
  disputed: number;
}): { cleared: boolean; paid_pct: number; reason: string | null } {
  if (input.consideration <= 0) {
    return { cleared: false, paid_pct: 0, reason: "no_consideration" };
  }
  const paid_pct = input.paid / input.consideration;
  if (input.disputed > 0) {
    return { cleared: false, paid_pct, reason: "unapproved_disputed_dues" };
  }
  if (paid_pct + 1e-9 < input.threshold_pct) {
    return { cleared: false, paid_pct, reason: "below_registration_threshold" };
  }
  return { cleared: true, paid_pct, reason: null };
}
