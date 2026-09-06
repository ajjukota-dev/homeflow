import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CommitmentsSection } from "./CommitmentsSection";
import type { Commitment } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ROW: Commitment = {
  id: "cmt_1", code: "CMT-1", project_id: "p1", booking_id: "bkg_1", customer_id: "cust_1", unit_id: "u1",
  category: "SERVICE", description: "Free AMC for year 1", committed_by_user_id: "user_crm", committed_at: "2026-09-01T00:00:00.000Z",
  source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, owner_user_id: "user_crm", responsible_department: "CRM",
  due_date: "2026-12-01", financial_impact_inr: 15000, approval_required: false, approved_by: null, approved_at: null,
  status: "ACTIVE", at_risk_reason: null, fulfilled_at: null, fulfilled_evidence_file_ids: [], customer_confirmed_at: null,
  crm_confirmation_note: null, breached_at: null, breach_root_cause: null, waived_reason: null, recovery_plan: null,
  recovery_due_date: null, depends_on: [], confidence: 82, confidence_drivers: [],
};

function mockFetch(opts: { rows?: Commitment[]; fails?: boolean } = {}) {
  const { rows = [ROW] } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.fails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url === "/api/bookings/bkg_1/commitments") return Promise.resolve(jsonResponse(200, { data: rows }));
      const single = rows.find((r) => url === `/api/commitments/${r.id}`);
      if (single) return Promise.resolve(jsonResponse(200, { data: { ...single, transitions: [] } }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("CommitmentsSection", () => {
  it("renders the booking's commitments", async () => {
    mockFetch();
    render(<CommitmentsSection bookingId="bkg_1" canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    expect(screen.getByText("Customer-facing")).toBeInTheDocument();
  });

  it("shows an honest empty state when the booking has no commitments", async () => {
    mockFetch({ rows: [] });
    render(<CommitmentsSection bookingId="bkg_1" canWrite={false} />);
    await waitFor(() => expect(screen.getByText("No commitments recorded on this booking yet.")).toBeInTheDocument());
  });

  it("shows an error state when the load fails", async () => {
    mockFetch({ fails: true });
    render(<CommitmentsSection bookingId="bkg_1" canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Couldn't load commitments for this booking.")).toBeInTheDocument());
  });

  it("hides 'New commitment' unless canWrite is true", async () => {
    mockFetch();
    const { rerender } = render(<CommitmentsSection bookingId="bkg_1" canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /New commitment/ })).not.toBeInTheDocument();
    rerender(<CommitmentsSection bookingId="bkg_1" canWrite={true} />);
    expect(screen.getByRole("button", { name: /New commitment/ })).toBeInTheDocument();
  });

  it("clicking a row opens the detail drawer for that commitment", async () => {
    mockFetch();
    render(<CommitmentsSection bookingId="bkg_1" canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Free AMC for year 1"));
    await waitFor(() => expect(screen.getByRole("heading", { name: /CMT-1/ })).toBeInTheDocument());
  });
});
