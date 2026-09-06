import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { PaymentPlanStudio } from "./PaymentPlanStudio";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PLAN = {
  id: "plan_eastcrest",
  project_id: "p_eastcrest",
  name: "Construction-linked plan",
  basis: "construction_linked",
  milestones: [
    { id: "plan_eastcrest_m1", milestone_key: "booking_token", milestone_label: "Booking amount", construction_trigger_event: null, sequence: 1, pct_of_consideration: 10 },
    { id: "plan_eastcrest_m2", milestone_key: "structure_milestone", milestone_label: "Structure complete", construction_trigger_event: "structure:complete", sequence: 2, pct_of_consideration: 30 },
  ],
};

const PROJECTS = [{ id: "p_eastcrest", code: "EASTCREST", name: "East Crest" }];

function mockFetch(opts: { createdPlan?: typeof PLAN } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/payment-plans" && method === "GET") return Promise.resolve(jsonResponse(200, { data: [PLAN] }));
      if (url === "/api/payment-plans" && method === "POST") return Promise.resolve(jsonResponse(200, { data: opts.createdPlan ?? PLAN }));
      if (url === "/api/payment-plans/plan_eastcrest" && method === "PUT") return Promise.resolve(jsonResponse(200, { data: PLAN }));
      if (url === "/api/projects") return Promise.resolve(jsonResponse(200, { data: PROJECTS }));
      return Promise.resolve(jsonResponse(200, { data: [] }));
    })
  );
}

describe("PaymentPlanStudio", () => {
  it("shows the real seeded plan's milestones ordered by sequence", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    expect(screen.getByText("Booking amount")).toBeInTheDocument();
    expect(screen.getByText("Structure complete")).toBeInTheDocument();
    expect(screen.getByText("structure:complete")).toBeInTheDocument();
  });

  it("hides edit affordances for a non-editing viewer", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("editing an existing plan pre-fills its milestones, add/remove works, and save calls PUT", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByDisplayValue("Booking amount")).toHaveLength(1);
    expect(within(dialog).getAllByDisplayValue("Structure complete")).toHaveLength(1);
    await waitFor(() => expect(within(dialog).getByText("East Crest")).toBeInTheDocument()); // Project selector pre-fills from plan.project_id

    fireEvent.click(within(dialog).getByRole("button", { name: "Add milestone" }));
    const keyInputs = within(dialog).getAllByLabelText("Key");
    fireEvent.change(keyInputs[keyInputs.length - 1], { target: { value: "final_milestone" } });
    const labelInputs = within(dialog).getAllByLabelText("Label");
    fireEvent.change(labelInputs[labelInputs.length - 1], { target: { value: "Final payment" } });
    const pctInputs = within(dialog).getAllByLabelText("% of total");
    fireEvent.change(pctInputs[pctInputs.length - 1], { target: { value: "60" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const putCall = fetchMock.mock.calls.find((c) => c[0] === "/api/payment-plans/plan_eastcrest" && c[1]?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body as string);
    expect(body.milestones).toHaveLength(3);
    expect(body.project_id).toBe("p_eastcrest"); // pre-filled from the plan being edited, not dropped
  });

  it("refuses to save when milestones don't have unique keys", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const keyInputs = within(dialog).getAllByLabelText("Key");
    fireEvent.change(keyInputs[1], { target: { value: "booking_token" } }); // duplicate of the first milestone's key
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/unique/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("new plan: fill the form and save calls POST with the entered milestones", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Flexi plan" } });
    fireEvent.change(within(dialog).getByLabelText("Key"), { target: { value: "token" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Token amount" } });
    fireEvent.change(within(dialog).getByLabelText("% of total"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const postCall = fetchMock.mock.calls.find((c) => c[0] === "/api/payment-plans" && c[1]?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall![1].body as string);
    expect(body.name).toBe("Flexi plan");
    expect(body.project_id).toBeNull(); // defaults to the standard template until a project is picked
    expect(body.milestones).toEqual([{ milestone_key: "token", milestone_label: "Token amount", construction_trigger_event: null, sequence: 1, pct_of_consideration: 100 }]);
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    mockFetch();
    render(<PaymentPlanStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Construction-linked plan")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows an honest empty state when there are no plans yet", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: [] }))));
    render(<PaymentPlanStudio canEdit={false} />);
    await waitFor(() => expect(screen.getByText("No payment plans yet.")).toBeInTheDocument());
  });
});
