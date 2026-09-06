import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { ActionDrawer } from "./ActionDrawer";
import type { ActionDetail } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BASE: ActionDetail = {
  id: "a1", code: "ACT-1", type: "exec_simple", family: "TASK", title: "Collect KYC documents", description: "Chase the customer for PAN + address proof.",
  project_id: "p1", source_module: "sales", source_entity_type: "booking", source_entity_id: "bkg_1",
  booking_id: "bkg_1", unit_id: null, customer_id: "cust_1",
  owner_user_id: null, owner_role: "CRM", backup_owner_user_id: null,
  due_at: "2026-09-06T10:00:00.000Z", priority: "HIGH", status: "New", sla_state: "AT_RISK",
  blocking_reason: null, depends_on_action_id: null, customer_visible: false, customer_title: null,
  evidence_requirement: "NONE", approver_role: null, verifier_role: null, external_reference: null,
  escalation_tier: "L0", origin: "AUTO", created_by: null, closed_at: null, closed_by: null, close_note: null,
  task_instance_id: null,
  checklist: [], evidence: [], transitions: [],
};

function mockFetch(detail: ActionDetail, onPost?: (url: string) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" || init?.method === "PUT") {
        onPost?.(url);
        return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
      }
      return Promise.resolve(jsonResponse(200, { data: detail }));
    })
  );
}

describe("ActionDrawer", () => {
  it("shows a loading state, then the real detail: status, SLA chip, why it exists", async () => {
    mockFetch(BASE);
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getByText("sales · booking #bkg_1")).toBeInTheDocument();
  });

  it("shows a retryable error state when the action fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }))));
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this action.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("New status offers Start and Cancel, not Close or Approve", async () => {
    mockFetch(BASE);
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    const actions = within(screen.getByRole("group", { name: "Available actions" }));
    expect(actions.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(actions.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(actions.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("a reason-required transition (Cancel) refuses to confirm with no reason typed", async () => {
    mockFetch(BASE);
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("needs a reason");
  });

  it("Start posts to /api/actions/:id/start and reloads the detail", async () => {
    const posted: string[] = [];
    mockFetch(BASE, (url) => posted.push(url));
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posted).toContain("/api/actions/a1/start"));
  });

  it("a second click on Start before the detail refetch resolves does not fire twice", async () => {
    const posted: string[] = [];
    let resolveGet: ((v: Response) => void) | null = null;
    let getCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(url);
          return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
        }
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse(200, { data: BASE }));
        // the post-transition refetch: held open until the test releases it
        return new Promise<Response>((resolve) => { resolveGet = resolve; });
      })
    );
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    const start = screen.getByRole("button", { name: "Start" });
    fireEvent.click(start);
    await waitFor(() => expect(posted).toContain("/api/actions/a1/start"));
    fireEvent.click(start);
    fireEvent.click(start);
    expect(posted).toEqual(["/api/actions/a1/start"]);
    resolveGet!(jsonResponse(200, { data: { ...BASE, status: "In Progress" } }));
  });

  it("a reason-required transition (Cancel) confirms once a reason is typed", async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push({ url, body: JSON.parse(init.body as string) });
          return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
        }
        return Promise.resolve(jsonResponse(200, { data: BASE }));
      })
    );
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByPlaceholderText("Cancellation reason"), { target: { value: "duplicate action" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Cancel" }));
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/actions/a1/cancel", body: { reason: "duplicate action" } }));
  });

  it("hides Close/Cancel and shows the journey-task note for a task-backed action", async () => {
    mockFetch({ ...BASE, status: "In Progress", task_instance_id: "ti1" });
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    const actions = within(screen.getByRole("group", { name: "Available actions" }));
    expect(actions.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(actions.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByText(/completes through its journey task/)).toBeInTheDocument();
  });

  it("renders checklist items and evidence rows with verify/reject controls", async () => {
    mockFetch({
      ...BASE,
      status: "In Progress",
      checklist: [{ id: "c1", label: "PAN verified", required: true, checked_at: null, checked_by: null }],
      evidence: [{ id: "e1", file_key: "project/p1/action/a1/pan.pdf", kind: "photo", uploaded_by: "u1", verification_status: "UPLOADED", verified_by: null, note: null, created_at: "2026-09-05T00:00:00.000Z" }],
    });
    render(<ActionDrawer actionId="a1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("ACT-1 · Collect KYC documents")).toBeInTheDocument());
    expect(screen.getByLabelText("PAN verified")).toBeInTheDocument();
    expect(screen.getByText("pan.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });
});
