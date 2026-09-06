import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { JourneyTimeline } from "./JourneyTimeline";
import type { Journey } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const JOURNEY: Journey = {
  id: "j1",
  status: "ACTIVE",
  health: "ON_TRACK",
  hold_reason: null,
  started_at: "2026-01-05T00:00:00.000Z",
  stages: [
    {
      stage_instance_id: "si1",
      stage_code: "BOOKING",
      name: "Booking",
      customer_name: "Your booking",
      stream: "COMMERCIAL",
      customer_visible: true,
      owner_department: "SALES",
      owner_user_id: null,
      status: "COMPLETED",
      progress_pct: 100,
      baseline_start: "2026-01-01",
      baseline_end: "2026-01-05",
      planned_start: "2026-01-01",
      planned_end: "2026-01-05",
      forecast_start: "2026-01-01",
      forecast_end: "2026-01-05",
      variance_days: 0,
      slippage_days: 0,
      tasks: [
        {
          task_instance_id: "ti1",
          task_code: "T1",
          title: "Collect booking form",
          customer_title: "We collected your booking form",
          customer_visible: true,
          execution_type: "MANUAL",
          action_id: "a1",
          status: "Closed",
          clock_status: "COMPLETED_ON_TIME",
          due_at: "2026-01-04T00:00:00.000Z",
        },
      ],
    },
  ],
};

const TASK_DETAIL = {
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
  forecast_end: "2026-01-05",
  actual_start: "2026-01-02",
  actual_end: "2026-01-05",
  clock: null,
  depends_on: [],
  blocks: [],
};

function mockFetch(opts: { journeyFails?: boolean; journeyMissing?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (opts.journeyFails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
      if (url === "/api/bookings/b1/journey") {
        // getForBooking 404s with not_found (never 200+null) when a booking has no journey yet.
        if (opts.journeyMissing) return Promise.resolve(jsonResponse(404, { errors: [{ code: "not_found" }] }));
        return Promise.resolve(jsonResponse(200, { data: JOURNEY }));
      }
      if (url === "/api/task-instances/ti1") return Promise.resolve(jsonResponse(200, { data: TASK_DETAIL }));
      if (url === "/api/studio/delay_reason") return Promise.resolve(jsonResponse(200, { data: [] }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("JourneyTimeline", () => {
  it("shows stages, tasks and journey health once loaded", async () => {
    mockFetch();
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    expect(screen.getByText("Collect booking form")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows an honest empty state when the booking has no journey yet", async () => {
    mockFetch({ journeyMissing: true });
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("No journey has started for this booking yet.")).toBeInTheDocument());
  });

  it("shows a retryable error state when the journey fails to load", async () => {
    mockFetch({ journeyFails: true });
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this journey.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("calls onBack when Back is clicked", async () => {
    mockFetch();
    const onBack = vi.fn();
    render(<JourneyTimeline bookingId="b1" onBack={onBack} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("switching to the customer view swaps in customer-facing labels", async () => {
    mockFetch();
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: "Customer view" }));
    expect(screen.getByText("Your booking")).toBeInTheDocument();
    expect(screen.getByText("We collected your booking form")).toBeInTheDocument();
  });

  it("opening the task detail drawer requests that task's detail", async () => {
    mockFetch();
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Collect booking form")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Collect booking form"));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/task-instances/ti1", expect.anything())
    );
  });

  it("Hold requires a typed reason before Confirm is allowed to proceed", async () => {
    mockFetch();
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(url);
          return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
        }
        if (url === "/api/bookings/b1/journey") return Promise.resolve(jsonResponse(200, { data: JOURNEY }));
        return Promise.resolve(jsonResponse(200, { data: [] }));
      })
    );
    render(<JourneyTimeline bookingId="b1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    const confirm = screen.getByRole("button", { name: "Confirm hold" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason to hold this journey/), { target: { value: "Customer requested pause" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(posted).toContain("/api/journeys/j1/hold"));
  });
});
