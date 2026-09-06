import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ProjectJourneyControl } from "./ProjectJourneyControl";
import type { ProjectJourneyControl as ProjectJourneyControlData } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DATA: ProjectJourneyControlData = {
  journeys: [
    {
      journey_id: "j1",
      booking_id: "b1",
      booking_number: "BKG-0001",
      unit_number: "A-101",
      customer_name: "Ravi Shankar",
      health: "AT_RISK",
      status: "ACTIVE",
      current_stage_per_stream: [{ stream: "CONSTRUCTION", stage_code: "STRUCTURE", name: "Structure work" }] as never,
      planned_handover: "2026-06-01",
      forecast_handover: "2026-06-15",
      slippage_days: 14,
    },
    {
      journey_id: "j2",
      booking_id: "b2",
      booking_number: "BKG-0002",
      unit_number: "A-102",
      customer_name: "Meera Iyer",
      health: "ON_TRACK",
      status: "ACTIVE",
      current_stage_per_stream: [{ stream: "LEGAL", stage_code: "AGREEMENT", name: "Sale agreement" }] as never,
      planned_handover: "2026-07-01",
      forecast_handover: "2026-07-01",
      slippage_days: 0,
    },
  ],
  top_delay_reasons: [{ code: "TOWER_SLAB_DELAY", label: "Tower slab delay", count: 5 }],
};

function mockFetch(opts: { data?: ProjectJourneyControlData; fails?: boolean } = {}) {
  const { data = DATA } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.fails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url === "/api/projects/p1/journey-control") return Promise.resolve(jsonResponse(200, { data }));
      if (url === "/api/studio/delay_reason") return Promise.resolve(jsonResponse(200, { data: [] }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("ProjectJourneyControl", () => {
  it("renders every journey with health, current stage, and slippage", async () => {
    mockFetch();
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Ravi Shankar")).toBeInTheDocument());
    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText("Structure work")).toBeInTheDocument();
    expect(screen.getByText("+14d")).toBeInTheDocument();
    expect(screen.getByText("On plan")).toBeInTheDocument();
  });

  it("shows the project's top delay reasons summary", async () => {
    mockFetch();
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Ravi Shankar")).toBeInTheDocument());
    expect(screen.getByText("Top delay reasons on this project")).toBeInTheDocument();
    expect(screen.getByText("Tower slab delay · 5")).toBeInTheDocument();
  });

  it("filtering by health hides journeys outside that filter", async () => {
    mockFetch();
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Ravi Shankar")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AT RISK" }));
    expect(screen.getByText("Ravi Shankar")).toBeInTheDocument();
    expect(screen.queryByText("Meera Iyer")).not.toBeInTheDocument();
  });

  it("shows an honest empty state when no journeys exist for the project", async () => {
    mockFetch({ data: { journeys: [], top_delay_reasons: [] } });
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("No journeys have started for this project yet.")).toBeInTheDocument());
  });

  it("shows a retryable error state when the control view fails to load", async () => {
    mockFetch({ fails: true });
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Couldn't load journeys for this project.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("selecting rows surfaces a bulk revise action with the right count", async () => {
    mockFetch();
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Ravi Shankar")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Revise plan for/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ravi Shankar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Meera Iyer" }));
    expect(screen.getByRole("button", { name: "Revise plan for 2 journeys" })).toBeInTheDocument();
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch();
    render(<ProjectJourneyControl projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Ravi Shankar")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
