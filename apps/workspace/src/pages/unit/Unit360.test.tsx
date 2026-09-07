import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Unit360 } from "./Unit360";
import type { Unit360View } from "../three-sixty/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SCORE = { value: 50, trend: "FLAT" as const, drivers: [], confidence: "MEDIUM" as const, confidence_reason: "why", actions: [] };

const VIEW: Unit360View = {
  unit_id: "u1",
  project_id: "p1",
  unit_number: "V101",
  unit_type: "3BHK",
  product_type: "APARTMENT",
  facing: "East",
  sale_status: "held",
  hierarchy_path: [{ kind: "PROJECT", name: "East Crest" }],
  areas: { carpet_sqft: 1200, built_up_sqft: 1400, saleable_sqft: 1500, plot_sqyd: null },
  base_price_inr: 8500000,
  current_booking: { id: "b1", booking_number: "BK-001", status: "active" },
  readiness: SCORE,
  flexibility: SCORE,
  tabs: [
    { key: "progress", label: "Progress", available: true, api: "/api/units/u1/progress" },
    { key: "customisations", label: "Customisations", available: false, api: null, unavailable_reason: "18 (no booking on this unit yet — nothing to show)" },
    { key: "activity", label: "Activity", available: true, api: "/api/units/u1/activity" },
  ],
};

function mockFetch(opts: { unitFails?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/units/u1/360") {
        if (opts.unitFails) return Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }));
        return Promise.resolve(jsonResponse(200, { data: VIEW }));
      }
      if (url === "/api/units/u1/progress") {
        return Promise.resolve(jsonResponse(200, { data: [{ component_code: "structure", state_code: "NOT_STARTED" }] }));
      }
      if (url === "/api/me/context") return Promise.resolve(jsonResponse(200, { data: {} }));
      if (url === "/api/projects/p1/header") {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              project_id: "p1", code: "EASTCREST", name: "East Crest", product_mix: [],
              units_sold: 1, units_available: 1, units_total: 2, true_risk_inr: 0, open_material_escalations: 0,
              unit_readiness_avg: 50, next_month_forecast_inr: 0, actual_to_date_inr: 0,
              handovers_due_30d: null, handovers_due_30d_reason: "no handover-stage forecast date exists",
            },
          })
        );
      }
      if (url === "/api/audit?entity_type=unit&entity_id=u1") return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("Unit360", () => {
  it("shows the villa header, details and readiness once loaded", async () => {
    mockFetch();
    render(<Unit360 unitId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Villa V101" })).toBeInTheDocument());
    expect(screen.getByText("BK-001 (active)")).toBeInTheDocument();
    expect(screen.getByText("Unit Readiness")).toBeInTheDocument();
  });

  it("shows a retryable error state when the unit fails to load", async () => {
    mockFetch({ unitFails: true });
    render(<Unit360 unitId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Couldn't load this unit.")).toBeInTheDocument());
  });

  it("degrades an unavailable tab to its named reason instead of fetching", async () => {
    mockFetch();
    render(<Unit360 unitId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Villa V101" })).toBeInTheDocument());
    const customisationsTab = screen.getByRole("tab", { name: /Customisations/ });
    customisationsTab.focus();
    await waitFor(() => expect(customisationsTab).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText(/no booking on this unit yet/)).toBeInTheDocument();
  });

  it("calls onBack when Back is clicked", async () => {
    mockFetch();
    const onBack = vi.fn();
    render(<Unit360 unitId="u1" onBack={onBack} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Villa V101" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
