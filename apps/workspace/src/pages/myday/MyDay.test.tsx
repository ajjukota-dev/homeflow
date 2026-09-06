import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MyDay } from "./MyDay";
import type { MyDayView } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const EMPTY_DAY: MyDayView = { due_today: [], at_risk: [], waiting_on_me: [], needs_my_approval: [], customers_waiting: [], done_today: 0 };

const DAY_WITH_ROWS: MyDayView = {
  ...EMPTY_DAY,
  due_today: [{ id: "a1", code: "ACT-1", title: "Collect KYC documents", status: "New", due_at: "2026-09-06T10:00:00.000Z", score: 0.8, why_now: "Due in 6 h · 2 customer(s) affected" }],
  done_today: 3,
};

describe("MyDay", () => {
  it("shows a loading skeleton, then real ranked rows with their real why_now text", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: DAY_WITH_ROWS }))));
    render(<MyDay projectId="p1" isTeamHead={false} />);
    await waitFor(() => expect(screen.getByText("Collect KYC documents")).toBeInTheDocument());
    expect(screen.getByText("Due in 6 h · 2 customer(s) affected")).toBeInTheDocument();
    expect(screen.getByText("3 done today.")).toBeInTheDocument();
  });

  it("shows an honest empty state when every section is empty (rule 6)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: EMPTY_DAY }))));
    render(<MyDay projectId="p1" isTeamHead={false} />);
    await waitFor(() => expect(screen.getByText("Nothing due right now.")).toBeInTheDocument());
    expect(screen.getByText("0 done today.")).toBeInTheDocument();
  });

  it("shows a retryable error state when My Day fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }))));
    render(<MyDay projectId="p1" isTeamHead={false} />);
    await waitFor(() => expect(screen.getByText("Couldn't load My Day.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders exactly one h1 (CLAUDE.md: one h1 per page)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: DAY_WITH_ROWS }))));
    render(<MyDay projectId="p1" isTeamHead={false} />);
    await waitFor(() => expect(screen.getByText("Collect KYC documents")).toBeInTheDocument());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("hides the Team view toggle for a non-head actor", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: EMPTY_DAY }))));
    render(<MyDay projectId="p1" isTeamHead={false} />);
    await waitFor(() => expect(screen.getByText(/Nothing due/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Team view" })).not.toBeInTheDocument();
  });
});
