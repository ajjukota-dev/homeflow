import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PlanRevisionDialog } from "./PlanRevisionDialog";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const REASONS = [{ code: "TOWER_SLAB_DELAY", label: "Tower slab delay", category: "CONSTRUCTION", counts_against_sla: false }];
const STAGES = [{ value: "POST_HANDOVER", label: "Post handover" }];

function mockFetch(opts: { reasons?: typeof REASONS; onPost?: (url: string, body: unknown) => void; failFor?: string } = {}) {
  const { reasons = REASONS } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/studio/delay_reason") return Promise.resolve(jsonResponse(200, { data: reasons }));
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        opts.onPost?.(url, body);
        if (opts.failFor && url.includes(opts.failFor)) return Promise.resolve(jsonResponse(400, { errors: [{ code: "bad_request", message: "stage not found" }] }));
        return Promise.resolve(jsonResponse(200, { data: { id: "pr1" } }));
      }
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("PlanRevisionDialog", () => {
  it("shows a hint pointing to Policy Studio when there are no delay reasons yet", async () => {
    mockFetch({ reasons: [] });
    render(<PlanRevisionDialog journeyIds={["j1"]} stageOptions={STAGES} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Policy Studio → Delay reasons/)).toBeInTheDocument());
  });

  it("refuses to save without new start/end dates", async () => {
    mockFetch();
    render(<PlanRevisionDialog journeyIds={["j1"]} stageOptions={STAGES} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save revision" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("New planned start and end are both required.");
  });

  it("shows the multi-journey framing for a bulk revision", async () => {
    mockFetch();
    render(<PlanRevisionDialog journeyIds={["j1", "j2", "j3"]} stageOptions={STAGES} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByText("Revise plan — 3 journeys")).toBeInTheDocument());
    expect(screen.getByText("One stage, one reason, applied to every selected journey.")).toBeInTheDocument();
  });

  it("still refuses to save with dates filled but no delay reason chosen (mandatory when a plan moves)", async () => {
    mockFetch();
    render(<PlanRevisionDialog journeyIds={["j1", "j2"]} stageOptions={STAGES} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save revision" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/New planned start/), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText(/New planned end/), { target: { value: "2026-03-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A delay reason is mandatory when a planned date moves.");
  });

  it("onClose fires when Cancel is clicked", async () => {
    mockFetch();
    const onClose = vi.fn();
    render(<PlanRevisionDialog journeyIds={["j1"]} stageOptions={STAGES} onClose={onClose} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save revision" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
