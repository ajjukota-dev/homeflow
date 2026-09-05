import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { ActivityFeed } from "./ActivityFeed";
import type { AuditRow } from "../api-events";

const rows: AuditRow[] = [
  {
    id: "1",
    occurred_at: new Date().toISOString(),
    type: "booking.created",
    entity_type: "booking",
    entity_id: "b1",
    project_id: "p1",
    actor_user_id: null,
    actor_kind: "SYSTEM",
    payload: { booking_number: "BK-1", total_consideration: 9000000 },
    source_ref: null,
  },
  {
    id: "2",
    occurred_at: new Date().toISOString(),
    type: "sales_handover.submitted",
    entity_type: "booking",
    entity_id: "b1",
    project_id: "p1",
    actor_user_id: null,
    actor_kind: "SYSTEM",
    payload: {},
    source_ref: null,
  },
];

function mockFetch(response: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => ({ data: response }) })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ActivityFeed (spec 02 Screens)", () => {
  it("shows a loading state, then renders events in plain language", async () => {
    mockFetch(rows);
    render(<ActivityFeed entityType="booking" entityId="b1" />);
    expect(screen.getByLabelText("Loading activity")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Booking BK-1 created/)).toBeInTheDocument());
    expect(screen.getByText("Submitted to CRM for review")).toBeInTheDocument();
  });

  it("shows an empty state when there is no activity", async () => {
    mockFetch([]);
    render(<ActivityFeed entityType="booking" entityId="b2" />);
    await waitFor(() => expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    mockFetch(null, false);
    render(<ActivityFeed entityType="booking" entityId="b3" />);
    await waitFor(() => expect(screen.getByText(/Couldn't load activity/)).toBeInTheDocument());
  });

  it("filters by family", async () => {
    mockFetch(rows);
    render(<ActivityFeed entityType="booking" entityId="b1" />);
    await waitFor(() => expect(screen.getByText(/Booking BK-1 created/)).toBeInTheDocument());
    act(() => screen.getByRole("radio", { name: "sales_handover" }).click());
    await waitFor(() => expect(screen.queryByText(/Booking BK-1 created/)).not.toBeInTheDocument());
    expect(screen.getByText("Submitted to CRM for review")).toBeInTheDocument();
  });
});
