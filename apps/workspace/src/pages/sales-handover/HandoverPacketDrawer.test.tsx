import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { HandoverPacketDrawer } from "./HandoverPacketDrawer";
import type { SalesHandover } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DRAFT: SalesHandover = {
  id: "sh_1",
  booking_id: "bkg_1",
  project_id: "p_eastcrest",
  status: "DRAFT",
  version: 0,
  packet: {
    customer_section: {
      display_name: "Rohan Desai", phone: "9876500000", pan: "ABCDE1234F", residency: "RESIDENT",
      applicant_details_confirmed: false, contact_verified: false, nri_status_confirmed: false, communication_pref_confirmed: false,
    },
    commercial_section: { final_price_inr: 8500000, discount_inr: 0, brokerage: 0, payment_plan_ref: null, booking_amount_inr: 500000, approved_deviations: [] },
    unit_section: { unit_number: "V113", unit_type: "3BHK Villa", facing: "East", product_type: "VILLA", unit_confirmed: false, facing_confirmed: false, parking_confirmed: false },
    documents_section: [{ type: "Booking Form", received: true }, { type: "PAN", received: false }],
    commitments_section: [],
  },
  completeness_score: 40,
  completeness_detail: [
    { item_code: "applicant_details_confirmed", kind: "CONFIRMATION", required: true, weight: 1, satisfied: false },
    { item_code: "PAN", kind: "DOCUMENT", required: true, weight: 1, satisfied: false },
  ],
  submitted_by: null, submitted_at: null, accepted_by: null, accepted_at: null,
  returned_by: null, returned_at: null, return_reason_code: null, return_note: null, first_time_right: null,
};

const SUBMITTED: SalesHandover = {
  ...DRAFT,
  status: "SUBMITTED",
  version: 1,
  completeness_score: 100,
  completeness_detail: DRAFT.completeness_detail!.map((d) => ({ ...d, satisfied: true })),
  submitted_by: "user_sales", submitted_at: "2026-09-07T00:00:00.000Z",
};

const ACCEPTED: SalesHandover = {
  ...SUBMITTED,
  status: "ACCEPTED",
  accepted_by: "user_crm", accepted_at: "2026-09-07T01:00:00.000Z", first_time_right: true,
};

function mockFetch(opts: { get: SalesHandover; onPost?: (url: string, body: unknown) => void; getNotFoundOnce?: boolean }) {
  let getCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/return-reasons") {
        return Promise.resolve(jsonResponse(200, { data: [{ code: "MISSING_DOCUMENTS", label: "Missing or incomplete documents", category: "DOCUMENTS" }] }));
      }
      if (init?.method === "POST") {
        const body = init.body ? JSON.parse(init.body as string) : {};
        opts.onPost?.(url, body);
        return Promise.resolve(jsonResponse(200, { data: { ...opts.get, id: "posted" } }));
      }
      getCalls += 1;
      if (opts.getNotFoundOnce && getCalls === 1) {
        return Promise.resolve(jsonResponse(404, { errors: [{ code: "not_found" }] }));
      }
      return Promise.resolve(jsonResponse(200, { data: opts.get }));
    })
  );
}

// The drawer's title repeats the customer's name (dialog header) and, for SUBMITTED/ACCEPTED,
// the review panel's own summary shows it again — so "loaded" is "at least one match", not "one".
async function waitLoaded(name: string) {
  await waitFor(() => expect(screen.queryAllByText(name).length).toBeGreaterThan(0));
}

describe("HandoverPacketDrawer", () => {
  it("DRAFT shows the editable form with the completeness checklist and missing items", async () => {
    mockFetch({ get: DRAFT });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Applicant Details Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for CRM review" })).toBeInTheDocument();
  });

  it("shows a retryable error state when the packet fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }))));
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this handover packet.")).toBeInTheDocument());
  });

  it("bootstraps a fresh DRAFT packet (via an empty submit) when none exists yet for this booking", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch({ get: DRAFT, getNotFoundOnce: true, onPost: (url, body) => posted.push({ url, body }) });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    expect(posted).toContainEqual({ url: "/api/bookings/bkg_1/sales-handover/submit", body: {} });
  });

  it("a blocked submit shows the blockers inline without changing status", async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = init.body ? JSON.parse(init.body as string) : {};
          posted.push({ url, body });
          return Promise.resolve(jsonResponse(400, { errors: [{ code: "gate_blocked", blockers: ["PAN"] }] }));
        }
        return Promise.resolve(jsonResponse(200, { data: DRAFT }));
      })
    );
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    fireEvent.click(screen.getByRole("button", { name: "Submit for CRM review" }));
    const notice = await screen.findByText("Saved, but not submitted — still missing:");
    expect(within(notice.parentElement!).getByText("PAN")).toBeInTheDocument();
    expect(posted[0].url).toBe("/api/bookings/bkg_1/sales-handover/submit");
  });

  it("editing confirmations and submitting posts the current form state", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch({ get: DRAFT, onPost: (url, body) => posted.push({ url, body }) });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    fireEvent.click(screen.getByLabelText("Applicant details confirmed"));
    fireEvent.click(screen.getByRole("button", { name: "Submit for CRM review" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0].body as { confirmations: { applicant_details_confirmed: boolean } };
    expect(body.confirmations.applicant_details_confirmed).toBe(true);
  });

  it("SUBMITTED shows a read-only review with Accept / Return, and a full checklist", async () => {
    mockFetch({ get: SUBMITTED });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Every required item is satisfied.")).toBeInTheDocument();
    const actions = within(screen.getByRole("group", { name: "Available actions" }));
    expect(actions.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: "Return to Sales" })).toBeInTheDocument();
  });

  it("accepting posts to the accept endpoint", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch({ get: SUBMITTED, onPost: (url, body) => posted.push({ url, body }) });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/bookings/bkg_1/sales-handover/accept", body: {} }));
  });

  it("returning requires picking a reason, sourced from the real return-reasons list", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch({ get: SUBMITTED, onPost: (url, body) => posted.push({ url, body }) });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    fireEvent.click(screen.getByRole("button", { name: "Return to Sales" }));
    await waitFor(() => expect(screen.getByText("Missing or incomplete documents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm return" }));
    await waitFor(() =>
      expect(posted).toContainEqual({
        url: "/api/bookings/bkg_1/sales-handover/return",
        body: { reason_code: "MISSING_DOCUMENTS", note: "" },
      })
    );
  });

  it("ACCEPTED is terminal: shows first-time-right, no action buttons", async () => {
    mockFetch({ get: ACCEPTED });
    render(<HandoverPacketDrawer bookingId="bkg_1" onClose={() => {}} />);
    await waitLoaded("Rohan Desai");
    expect(screen.getByText(/first time right/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Available actions" })).not.toBeInTheDocument();
  });
});
