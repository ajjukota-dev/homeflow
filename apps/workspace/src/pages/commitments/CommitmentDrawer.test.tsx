import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { CommitmentDrawer } from "./CommitmentDrawer";
import type { CommitmentDetail } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BASE: CommitmentDetail = {
  id: "cmt_1", code: "CMT-1", project_id: "p1", booking_id: "bkg_1", customer_id: "cust_1", unit_id: "u1",
  category: "SERVICE", description: "Free AMC for year 1", committed_by_user_id: "user_crm", committed_at: "2026-09-01T00:00:00.000Z",
  source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, owner_user_id: "user_crm", responsible_department: "CRM",
  due_date: "2026-12-01", financial_impact_inr: 15000, approval_required: false, approved_by: null, approved_at: null,
  status: "ACTIVE", at_risk_reason: null, fulfilled_at: null, fulfilled_evidence_file_ids: [], customer_confirmed_at: null,
  crm_confirmation_note: null, breached_at: null, breach_root_cause: null, waived_reason: null, recovery_plan: null,
  recovery_due_date: null, depends_on: [], confidence: 82, confidence_drivers: [{ label: "owner has 1 other open item", delta: -4 }],
  transitions: [{ id: "t1", from_status: "APPROVED", to_status: "ACTIVE", at: "2026-09-01T00:00:00.000Z", actor_user_id: "user_crm", reason: null }],
};

function mockFetch(detail: CommitmentDetail, onPost?: (url: string, body: unknown) => void, postStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = init.body ? JSON.parse(init.body as string) : {};
        onPost?.(url, body);
        if (postStatus !== 200) return Promise.resolve(jsonResponse(postStatus, { errors: [{ code: "forbidden", message: "not allowed" }] }));
        return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
      }
      return Promise.resolve(jsonResponse(200, { data: detail }));
    })
  );
}

describe("CommitmentDrawer", () => {
  it("shows the real detail: status, category, confidence, and the timeline", async () => {
    mockFetch(BASE);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument();
    expect(screen.getByText("Confidence 82")).toBeInTheDocument();
    expect(screen.getByText("Customer-facing")).toBeInTheDocument();
    expect(screen.getByText(/APPROVED → ACTIVE/)).toBeInTheDocument();
  });

  it("shows a retryable error state when the commitment fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }))));
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this commitment.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("ACTIVE offers Fulfil, Flag at risk, and Waive — not Activate or Approve", async () => {
    mockFetch(BASE);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    const actions = within(screen.getByRole("group", { name: "Available actions" }));
    expect(actions.getByRole("button", { name: "Fulfil" })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: "Flag at risk" })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: "Waive / cancel" })).toBeInTheDocument();
    expect(actions.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(actions.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("fulfil refuses to confirm with no evidence reference typed", async () => {
    mockFetch(BASE);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At least one evidence reference is required.");
  });

  it("a customer-facing fulfil with evidence but no confirmation is refused", async () => {
    mockFetch(BASE);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.change(screen.getByLabelText(/Evidence reference/), { target: { value: "site photo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Customer-facing commitments need the customer's confirmation");
  });

  it("fulfils once evidence and a CRM confirmation note are both given", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch(BASE, (url, body) => posted.push({ url, body }));
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.change(screen.getByLabelText(/Evidence reference/), { target: { value: "site photo, whatsapp confirmation" } });
    fireEvent.change(screen.getByLabelText(/CRM confirmation note/), { target: { value: "Customer confirmed over call" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    await waitFor(() =>
      expect(posted).toContainEqual({
        url: "/api/commitments/cmt_1/fulfil",
        body: { evidence_file_ids: ["site photo", "whatsapp confirmation"], customer_confirmed_at: null, crm_confirmation_note: "Customer confirmed over call" },
      })
    );
  });

  it("waive requires a reason", async () => {
    mockFetch(BASE);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Waive / cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm waive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A reason is required to waive a commitment.");
  });

  it("a server 403 surfaces inline (no client-side role simulation, per ActionDrawer's own precedent)", async () => {
    mockFetch(BASE, undefined, 403);
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Flag at risk" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm flag at risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not allowed");
  });

  it("BREACHED offers Record root cause, and shows the recorded cause once set", async () => {
    mockFetch({ ...BASE, status: "BREACHED", breach_root_cause: "OVERPROMISED" });
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Record root cause" })).toBeInTheDocument();
    expect(screen.getByText("Root cause: Overpromised")).toBeInTheDocument();
  });

  it("terminal statuses (FULFILLED) offer no actions", async () => {
    mockFetch({ ...BASE, status: "FULFILLED", fulfilled_at: "2026-09-05T00:00:00.000Z", fulfilled_evidence_file_ids: ["file_1"] });
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Available actions" })).not.toBeInTheDocument();
  });

  it("a FULFILLED commitment that was once AT_RISK doesn't show a stale 'At risk' banner (backend never clears at_risk_reason)", async () => {
    mockFetch({
      ...BASE,
      status: "FULFILLED",
      at_risk_reason: "Vendor delay",
      fulfilled_at: "2026-09-05T00:00:00.000Z",
      fulfilled_evidence_file_ids: ["file_1"],
    });
    render(<CommitmentDrawer commitmentId="cmt_1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("CMT-1 · Service")).toBeInTheDocument());
    expect(screen.queryByText(/^At risk:/)).not.toBeInTheDocument();
  });
});
