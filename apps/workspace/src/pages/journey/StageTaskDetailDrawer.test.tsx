import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StageTaskDetailDrawer } from "./StageTaskDetailDrawer";
import type { TaskDetail } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DETAIL: TaskDetail = {
  id: "ti1",
  task_code: "T1",
  title: "Collect booking form",
  customer_title: "We collected your booking form",
  status: "Closed",
  action_id: "a1",
  baseline_start: "2026-01-01",
  baseline_end: "2026-01-05",
  planned_start: "2026-01-01",
  planned_end: "2026-01-05",
  forecast_start: "2026-01-01",
  forecast_end: "2026-01-06",
  actual_start: "2026-01-02",
  actual_end: "2026-01-05",
  clock: {
    due_at: "2026-01-05T00:00:00.000Z",
    stopped_at: "2026-01-05T00:00:00.000Z",
    outcome: "ON_TIME",
    status: "COMPLETED_ON_TIME",
    total_paused_seconds: 3600,
    events: [
      { at: "2026-01-01T09:00:00.000Z", kind: "START", reason: null },
      { at: "2026-01-02T09:00:00.000Z", kind: "PAUSE", reason: "Waiting on customer" },
      { at: "2026-01-02T12:00:00.000Z", kind: "RESUME", reason: null },
    ],
  },
  depends_on: [{ task_code: "T0", kind: "FINISH_TO_START", lag_days: 0 }],
  blocks: [{ task_code: "T2", kind: "FINISH_TO_START", lag_days: 0 }],
};

function mockFetch(opts: { detailFails?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.detailFails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url === "/api/task-instances/ti1") return Promise.resolve(jsonResponse(200, { data: DETAIL }));
      if (url === "/api/actions/a1") return Promise.resolve(jsonResponse(200, { data: { id: "a1", checklist: [], evidence: [], transitions: [] } }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("StageTaskDetailDrawer", () => {
  it("renders nothing when no task is selected", () => {
    mockFetch();
    render(<StageTaskDetailDrawer taskInstanceId={null} onClose={() => {}} />);
    expect(screen.queryByText("Collect booking form")).not.toBeInTheDocument();
  });

  it("shows dates, clock pause history, dependencies, and an evidence link", async () => {
    mockFetch();
    render(<StageTaskDetailDrawer taskInstanceId="ti1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Customer sees: "We collected your booking form"')).toBeInTheDocument());
    expect(screen.getByText("PAUSE")).toBeInTheDocument();
    expect(screen.getByText(/Waiting on customer/)).toBeInTheDocument();
    expect(screen.getByText(/Depends on: T0/)).toBeInTheDocument();
    expect(screen.getByText(/Blocks: T2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View evidence & action/ })).toBeInTheDocument();
  });

  it("shows a reopen form for a closed task and posts the reason", async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push({ url, body: JSON.parse(init.body as string) });
          return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
        }
        if (url === "/api/task-instances/ti1") return Promise.resolve(jsonResponse(200, { data: DETAIL }));
        return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
      })
    );
    render(<StageTaskDetailDrawer taskInstanceId="ti1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Reopen")).toBeInTheDocument());
    const reopenBtn = screen.getByRole("button", { name: "Reopen task" });
    expect(reopenBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for reopening"), { target: { value: "Evidence was wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Reopen task" }));
    await waitFor(() => expect(posted).toContainEqual({ url: "/api/task-instances/ti1/reopen", body: { reason: "Evidence was wrong" } }));
  });

  it("shows a retryable error state when the task fails to load", async () => {
    mockFetch({ detailFails: true });
    render(<StageTaskDetailDrawer taskInstanceId="ti1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this task.")).toBeInTheDocument());
  });
});
