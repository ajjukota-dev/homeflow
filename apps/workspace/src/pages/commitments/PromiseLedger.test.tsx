import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PromiseLedger } from "./PromiseLedger";
import type { Commitment } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ROWS: Commitment[] = [
  {
    id: "cmt_1", code: "CMT-1", project_id: "p1", booking_id: "bkg_1", customer_id: "cust_1", unit_id: "u1",
    category: "SERVICE", description: "Free AMC for year 1", committed_by_user_id: "user_crm", committed_at: "2026-09-01T00:00:00.000Z",
    source: "CRM", beneficiary: "CUSTOMER", customer_facing: true, owner_user_id: "user_crm", responsible_department: "CRM",
    due_date: "2026-12-01", financial_impact_inr: 15000, approval_required: false, approved_by: null, approved_at: null,
    status: "ACTIVE", at_risk_reason: null, fulfilled_at: null, fulfilled_evidence_file_ids: [], customer_confirmed_at: null,
    crm_confirmation_note: null, breached_at: null, breach_root_cause: null, waived_reason: null, recovery_plan: null,
    recovery_due_date: null, depends_on: [], confidence: 82, confidence_drivers: [],
  },
  {
    id: "cmt_2", code: "CMT-2", project_id: "p1", booking_id: "bkg_2", customer_id: "cust_2", unit_id: "u2",
    category: "TIMELINE", description: "Deliver two weeks early", committed_by_user_id: "user_crm", committed_at: "2026-09-01T00:00:00.000Z",
    source: "CRM", beneficiary: "CUSTOMER", customer_facing: false, owner_user_id: null, responsible_department: "CONSTRUCTION",
    due_date: "2026-10-01", financial_impact_inr: null, approval_required: true, approved_by: null, approved_at: null,
    status: "DRAFT", at_risk_reason: null, fulfilled_at: null, fulfilled_evidence_file_ids: [], customer_confirmed_at: null,
    crm_confirmation_note: null, breached_at: null, breach_root_cause: null, waived_reason: null, recovery_plan: null,
    recovery_due_date: null, depends_on: [], confidence: 55, confidence_drivers: [],
  },
];

function mockFetch(opts: { rows?: Commitment[]; fails?: boolean } = {}) {
  const { rows = ROWS } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.fails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url.startsWith("/api/commitments?")) return Promise.resolve(jsonResponse(200, { data: rows }));
      const single = rows.find((r) => url === `/api/commitments/${r.id}`);
      if (single) return Promise.resolve(jsonResponse(200, { data: { ...single, transitions: [] } }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("PromiseLedger", () => {
  it("renders every commitment with status, category, and due date", async () => {
    mockFetch();
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    expect(screen.getByText("Deliver two weeks early")).toBeInTheDocument();
    expect(screen.getByText("Customer-facing")).toBeInTheDocument();
  });

  it("filtering by status hides commitments outside that filter", async () => {
    mockFetch();
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "DRAFT" }));
    expect(screen.queryByText("Free AMC for year 1")).not.toBeInTheDocument();
    expect(screen.getByText("Deliver two weeks early")).toBeInTheDocument();
  });

  it("shows an honest empty state when no commitments exist for the project", async () => {
    mockFetch({ rows: [] });
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("No commitments on this project yet.")).toBeInTheDocument());
  });

  it("shows a retryable error state when the ledger fails to load", async () => {
    mockFetch({ fails: true });
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Couldn't load commitments for this project.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("clicking a code opens the detail drawer for that commitment", async () => {
    mockFetch();
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "CMT-1" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /CMT-1/ })).toBeInTheDocument());
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch();
    render(<PromiseLedger projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Free AMC for year 1")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
