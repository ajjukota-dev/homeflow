// Row shapes returned by bookings.ts db.query calls (kept separate to respect the 200-line rule).

export interface BookingDetailRow {
  id: string;
  booking_number: string;
  status: string;
  total_consideration: number;
  completeness_score: number;
  return_reason: string | null;
  rm_owner: string | null;
  unit_number: string;
  unit_type: string;
  facing: string;
  applicant_name: string | null;
  applicant_phone: string | null;
  applicant_pan: string | null;
}

export interface BookingListRow {
  id: string;
  booking_number: string;
  status: string;
  total_consideration: number;
  completeness_score: number;
  return_reason: string | null;
  unit_number: string;
  unit_type: string;
  applicant_name: string | null;
  applicant_phone: string | null;
}

export interface CustomerListRow {
  id: string;
  display_name: string;
  primary_phone: string | null;
  kyc_status: string;
  booking_number: string;
  unit_number: string;
}

export interface CustomerRow {
  id: string;
  customer_type: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  kyc_status: string;
  created_at: Date;
}
