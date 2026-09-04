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
  due_date: string | null; // null until the construction trigger fires — shown as "Upcoming"
  status: string;
  why_now: string;
}
export interface Payments {
  schedule: PaymentLine[];
  paid_total: number;
  remaining_total: number;
  receipts: { receipt_id: string; amount: number; date: string }[];
  next_due: { milestone_label: string; amount: number; due_date: string | null } | null;
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

export async function getHome(): Promise<Home> {
  const res = await fetch("/api/me/home");
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).data as Home;
}
