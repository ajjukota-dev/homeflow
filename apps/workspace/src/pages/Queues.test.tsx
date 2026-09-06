import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Queues } from "./Queues";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ROW = {
  id: "act1",
  code: "ACT-000004",
  type: "exec_evidence",
  title: "Collect PAN + Address proof",
  status: "New",
  priority: "HIGH",
  owner_user_id: null,
  owner_role: "CRM",
  due_at: null,
  customer_visible: true,
  project_id: "p1",
};

function mockFetch(opts: { rows?: unknown[]; usersOk?: boolean; queueFails?: boolean }) {
  const { rows = [ROW], usersOk = true } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.queueFails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url.startsWith("/api/actions?")) return Promise.resolve(jsonResponse(200, { data: rows }));
      if (url === "/api/admin/users") {
        return usersOk
          ? Promise.resolve(jsonResponse(200, { data: [{ id: "u1", email: "u1@x.com", display_name: "Kabir Shah", status: "ACTIVE", kind: "STAFF", roles: ["SALES"] }] }))
          : Promise.resolve(jsonResponse(403, { errors: [{ code: "forbidden" }] }));
      }
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    }),
  );
}

describe("Queues", () => {
  it("shows real rows with claim available for an unassigned action", async () => {
    mockFetch({});
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText("Collect PAN + Address proof")).toBeInTheDocument());
    expect(screen.getByText("Unassigned (CRM / RM queue)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument();
  });

  it("shows an honest empty state when a department queue has nothing open", async () => {
    mockFetch({ rows: [] });
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText(/No open actions in/)).toBeInTheDocument());
  });

  it("shows a retryable error state when the queue fails to load", async () => {
    mockFetch({ queueFails: true });
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this queue.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("hides bulk-reassign selection for a non-Management actor", async () => {
    mockFetch({});
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText("Collect PAN + Address proof")).toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows bulk-reassign selection for Management", async () => {
    mockFetch({});
    render(<Queues projectId="p1" roles={["MANAGEMENT"]} />);
    await waitFor(() => expect(screen.getByText("Collect PAN + Address proof")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /Select ACT-000004/ })).toBeInTheDocument();
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch({});
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText("Collect PAN + Address proof")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  // Regression: counts must come from the same project-scoped rows as the list below them, not
  // from a separate global endpoint — `getQueue` has no project_id, so a badge sourced from it
  // could disagree with a project-filtered row list (caught in review before landing).
  it("derives status counts from the project-scoped rows, not a separate global count", async () => {
    mockFetch({
      rows: [
        ROW,
        { ...ROW, id: "act2", code: "ACT-000005", title: "Draft sale agreement", status: "New" },
        { ...ROW, id: "act3", code: "ACT-000006", title: "Escalate delayed handover", status: "Blocked" },
      ],
    });
    render(<Queues projectId="p1" roles={["CRM"]} />);
    await waitFor(() => expect(screen.getByText("Escalate delayed handover")).toBeInTheDocument());
    expect(screen.getByText("New: 2")).toBeInTheDocument();
    expect(screen.getByText("Blocked: 1")).toBeInTheDocument();
  });
});
