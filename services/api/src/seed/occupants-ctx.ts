import type { Ctx } from "../authz/types";
import { MANDATORY_DOCS, type BookingSeedIds } from "../bookings";
import type { AcceptSeedIds } from "../bookings-crm";
import { PROJECT_ID } from "./users";

// Staff ctxs for the handler-based occupant seed. user_* ids match seed/users.ts.

export const FULL_DOCS = MANDATORY_DOCS.map((type) => ({ type, received: true }));

export const FULL_CONFIRMATIONS = {
  applicant_details_confirmed: true,
  contact_verified: true,
  nri_status_confirmed: true,
  communication_pref_confirmed: true,
  unit_confirmed: true,
  facing_confirmed: true,
  parking_confirmed: true,
};

export function staff(slug: string, roles: string[]): Ctx {
  return {
    actor: {
      user_id: `user_${slug}`,
      display_name: slug,
      kind: "STAFF",
      roles,
      project_ids: "ALL",
      default_project_id: PROJECT_ID,
    },
  };
}

export const sales = staff("sales", ["SALES"]);
export const crm = staff("crm", ["CRM"]);
export const legal = staff("legal", ["LEGAL"]);
export const accounts = staff("accounts", ["ACCOUNTS"]);
export const banking = staff("banking", ["BANKING"]);
export const qa = staff("qa", ["QA"]);
export const fm = staff("fm", ["FM"]);
export const registration = staff("registration", ["REGISTRATION"]);
export const site = staff("site", ["SITE"]);
export const customisation = staff("customisation", ["CUSTOMISATION"]);
export const sa = staff("superadmin", ["SUPER_ADMIN"]);

export interface OccupantSpec {
  unit_id: string;
  booking_id: string;
  booking_number: string;
  customer_id: string;
  applicant_id: string;
  name: string;
  phone: string;
  pan: string;
  consideration: number;
  demand_ids: string[];
}

export const KARTHIK: OccupantSpec = {
  unit_id: "u_v110", booking_id: "b_v110", booking_number: "BK-V110", customer_id: "c_karthik",
  applicant_id: "a_v110", name: "Karthik Iyer", phone: "9845011122", pan: "ABCDE1234F",
  consideration: 12_000_000, demand_ids: ["d_v110_1", "d_v110_2", "d_v110_3", "d_v110_4", "d_v110_5"],
};
export const MEERA: OccupantSpec = {
  unit_id: "u_v111", booking_id: "b_v111", booking_number: "BK-V111", customer_id: "c_meera",
  applicant_id: "a_v111", name: "Meera Krishnan", phone: "9845033344", pan: "XYZAB1234C",
  consideration: 8_000_000, demand_ids: ["d_v111_1", "d_v111_2", "d_v111_3", "d_v111_4", "d_v111_5"],
};
export const ANANYA: OccupantSpec = {
  unit_id: "u_v112", booking_id: "b_v112", booking_number: "BK-V112", customer_id: "c_ananya",
  applicant_id: "a_v112", name: "Ananya Rao", phone: "9845055566", pan: "PQRST6789L",
  consideration: 10_000_000, demand_ids: ["d_v112_1", "d_v112_2", "d_v112_3", "d_v112_4", "d_v112_5"],
};
export const ROHAN: OccupantSpec = {
  unit_id: "u_v113", booking_id: "b_v113", booking_number: "BK-V113", customer_id: "c_rohan",
  applicant_id: "a_v113", name: "Rohan Desai", phone: "9845077788", pan: "LMNOP4321K",
  consideration: 9_500_000, demand_ids: ["d_v113_1", "d_v113_2", "d_v113_3", "d_v113_4", "d_v113_5"],
};

export function bookingSeed(o: OccupantSpec): BookingSeedIds {
  return { booking_id: o.booking_id, booking_number: o.booking_number, applicant_id: o.applicant_id };
}
export function acceptSeed(o: OccupantSpec): AcceptSeedIds {
  return { customer_id: o.customer_id, demand_ids: o.demand_ids };
}
