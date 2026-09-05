import { get } from "@homeflow/ui";

export interface Stage {
  label: string;
  state: "done" | "current" | "upcoming";
}
export interface PersonalisationWindow {
  label: string;
  window: string;
}
export interface PaymentLine {
  milestone_label: string;
  amount: number;
  due_date: string;
  status: string;
  why_now: string;
}
export interface Payments {
  schedule: PaymentLine[];
  paid_total: number;
  remaining_total: number;
  receipts: { receipt_id: string; amount: number; date: string }[];
  next_due: { milestone_label: string; amount: number; due_date: string } | null;
}
export interface PassportItem {
  type: string;
  name: string;
  brand_model: string | null;
  paint_tile_code: string | null;
  warranty_months: number | null;
}
export interface LegalSafety {
  rera_reg_no: string | null;
  escrow_note: string | null;
  my_documents: { name: string; status: string }[];
}
export interface KeysWindow {
  expected_window: string;
  confidence_label: string;
  my_todos: { label: string; status: string }[];
}
export interface Home {
  customer_name: string;
  project_name: string;
  unit_number: string;
  unit_type: string;
  facing: string;
  booking_status: string;
  total_consideration: number;
  stages: Stage[];
  current_stage: string;
  next_stage: string | null;
  personalisation: PersonalisationWindow[];
  payments: Payments | null;
  passport: PassportItem[];
  legal: LegalSafety;
  keys: KeysWindow;
}

/**
 * The customer projection (technical/07 customer_portal). Goes through the
 * shared client so it carries the session cookie, the CSRF header and the
 * `{data, meta}` unwrapping, and so a 401 flips the sign-in gate instead of
 * rendering a dead page (technical/09 §3).
 *
 * ponytail: `/me/home` is not built yet — it arrives with TASKS Vivek 15
 * (customer_portal). Until then this call 404s and the page shows its error
 * state, which is the honest thing to render.
 */
export async function getHome(): Promise<Home> {
  return get<Home>("/me/home");
}
