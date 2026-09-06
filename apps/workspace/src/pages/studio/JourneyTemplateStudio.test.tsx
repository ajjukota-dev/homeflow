import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { JourneyTemplateStudio } from "./JourneyTemplateStudio";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TEMPLATE = { id: "jt_1", code: "PRANAVA_STANDARD", name: "Pranava Standard", scope: "STANDARD", project_id: null, product_type: null, latest_version: 1, latest_status: "PUBLISHED" };
const VERSION_SUMMARY = { id: "jtv_1", version: 1, status: "PUBLISHED", published_at: "2026-01-01T00:00:00Z", change_note: null };
const VERSION_DATA = {
  id: "jtv_1",
  template_id: "jt_1",
  version: 1,
  status: "PUBLISHED",
  change_note: null,
  stages: [
    {
      code: "BOOKING",
      name: "Booking",
      customer_name: "Booking",
      sort_order: 0,
      stream: "COMMERCIAL",
      customer_visible: true,
      planned_duration_days: 5,
      owner_department: "SALES",
      is_mandatory: true,
      condition_expr: null,
      tasks: [{ code: "T1", title: "Collect KYC", owner_role: "SALES", task_type: "MANDATORY", execution_type: "SIMPLE", priority: "HIGH", sort_order: 0 }],
      visibility: [],
    },
  ],
  dependencies: [],
};

function mockFetch(opts: { previewResult?: unknown[] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/journey-templates") return Promise.resolve(jsonResponse(200, { data: [TEMPLATE] }));
      if (url === "/api/journey-templates/jt_1/versions") return Promise.resolve(jsonResponse(200, { data: [VERSION_SUMMARY] }));
      if (url === "/api/journey-template-versions/jtv_1") return Promise.resolve(jsonResponse(200, { data: VERSION_DATA }));
      if (url.startsWith("/api/journey-template-versions/jtv_1/preview")) return Promise.resolve(jsonResponse(200, { data: opts.previewResult ?? [{ stage_code: "BOOKING", task_codes: ["T1"] }] }));
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("JourneyTemplateStudio", () => {
  it("shows the seeded Pranava Standard template with its published version and stage", async () => {
    mockFetch();
    render(<JourneyTemplateStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    expect(screen.getByText("PUBLISHED")).toBeInTheDocument();
    expect(screen.getByText(/Collect KYC/)).toBeInTheDocument();
  });

  it("hides edit affordances (Add stage, New template) for a non-editing viewer", async () => {
    mockFetch();
    render(<JourneyTemplateStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New template" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add stage/ })).not.toBeInTheDocument();
  });

  it("shows edit affordances for Management but disables editing on a PUBLISHED version", async () => {
    mockFetch();
    render(<JourneyTemplateStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New template" })).toBeInTheDocument();
    expect(screen.getByText(/Only a DRAFT version can be edited/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add stage/ })).not.toBeInTheDocument();
  });

  it("runs a preview and shows which stages/tasks would instantiate", async () => {
    mockFetch();
    render(<JourneyTemplateStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Run preview" }));
    await waitFor(() => expect(within(dialog).getByText(/1 task: T1/)).toBeInTheDocument());
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch();
    render(<JourneyTemplateStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows an honest empty state when there are no templates yet", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: [] }))));
    render(<JourneyTemplateStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("No journey templates yet.")).toBeInTheDocument());
  });
});
