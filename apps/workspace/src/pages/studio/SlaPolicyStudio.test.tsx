import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { SlaPolicyStudio } from "./SlaPolicyStudio";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const POLICY = {
  id: "sla_kyc_docs",
  code: "KYC_DOCS",
  applies_to: "TASK_CODE",
  target_ref: "T3",
  duration_value: 5,
  duration_unit: "WORKING_DAYS",
  due_soon_lead_days: 2,
  at_risk_rule: null,
  pause_reasons: [],
  escalation_ladder_id: "ladder_standard",
  effective_from: "2026-01-01",
  effective_to: null,
  version: 1,
};
const DELAY_REASON = { code: "WAITING_CUSTOMER", label: "Waiting on customer", category: "CUSTOMER", counts_against_sla: false };

function mockFetch(opts: { previewClocks?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/studio/sla_policy" && method === "GET") return Promise.resolve(jsonResponse(200, { data: [POLICY] }));
      if (url === "/api/studio/delay_reason" && method === "GET") return Promise.resolve(jsonResponse(200, { data: [DELAY_REASON] }));
      if (url === "/api/studio/sla_policy" && method === "POST") return Promise.resolve(jsonResponse(200, { data: { id: "pv_draft_1" } }));
      if (url === "/api/studio/sla_policy/preview" && method === "POST") return Promise.resolve(jsonResponse(200, { data: { open_sla_clocks: opts.previewClocks ?? 0 } }));
      if (url === "/api/studio/sla_policy/pv_draft_1/publish" && method === "POST") return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
      return Promise.resolve(jsonResponse(200, { data: [] }));
    })
  );
}

describe("SlaPolicyStudio", () => {
  it("shows the seeded policy's real fields", async () => {
    mockFetch();
    render(<SlaPolicyStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    expect(screen.getByText("T3")).toBeInTheDocument();
    expect(screen.getByText(/5 working days/)).toBeInTheDocument();
  });

  it("hides edit affordances for a non-editing viewer", async () => {
    mockFetch();
    render(<SlaPolicyStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New policy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the real open-clock impact before publish, then publishes on confirm", async () => {
    mockFetch({ previewClocks: 3 });
    render(<SlaPolicyStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(within(dialog).getByText(/affects 3 currently open SLA clocks/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm & publish" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a zero-impact change says so plainly rather than a scary count", async () => {
    mockFetch({ previewClocks: 0 });
    render(<SlaPolicyStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(within(dialog).getByText(/No open SLA clocks currently reference this policy/)).toBeInTheDocument());
  });

  it("new policy: fill the form, see the real impact, then publish — the path only the drafted, not-yet-existing rowId exercises", async () => {
    mockFetch({ previewClocks: 0 });
    render(<SlaPolicyStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New policy" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Policy id/), { target: { value: "sla_new_thing" } });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "NEW_THING" } });
    fireEvent.change(within(dialog).getByLabelText(/Target ref/), { target: { value: "T99" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // The id just typed has no sla_policy row yet — previewChange still returns a real (zero)
    // count rather than erroring, because the count is against sla_clock.policy_id, not a row
    // that must already exist in sla_policy.
    await waitFor(() => expect(within(dialog).getByText(/No open SLA clocks currently reference this policy/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm & publish" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch();
    render(<SlaPolicyStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("KYC_DOCS")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows an honest empty state when there are no policies yet", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: [] }))));
    render(<SlaPolicyStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("No SLA policies yet.")).toBeInTheDocument());
  });
});
