import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateCommitmentDialog } from "./CreateCommitmentDialog";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(onPost: (url: string, body: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      onPost(url, body);
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    })
  );
}

describe("CreateCommitmentDialog", () => {
  it("refuses to create with no description typed", async () => {
    mockFetch(() => {});
    render(<CreateCommitmentDialog bookingId="bkg_1" onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Create commitment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A description is required.");
  });

  it("creates against the booking with source hardcoded to CRM", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch((url, body) => posted.push({ url, body }));
    const onCreated = vi.fn();
    render(<CreateCommitmentDialog bookingId="bkg_1" onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Free AMC for year 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create commitment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(posted).toContainEqual({
      url: "/api/commitments",
      body: {
        booking_id: "bkg_1",
        category: "OTHER",
        description: "Free AMC for year 1",
        source: "CRM",
        beneficiary: "CUSTOMER",
        customer_facing: true,
        owner_user_id: null,
        responsible_department: null,
        due_date: null,
        financial_impact_inr: null,
        approval_required: false,
      },
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    mockFetch(() => {});
    const onClose = vi.fn();
    render(<CreateCommitmentDialog bookingId="bkg_1" onClose={onClose} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
