import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Money } from "./Money";
import { DateText } from "./DateText";
import { Skeleton, SkeletonTable } from "./Skeleton";
import { Table } from "./Table";
import { EmptyState } from "./EmptyState";

describe("Money", () => {
  it("abbreviates a crore and keeps the exact figure in the title", () => {
    render(<Money value={47_500_000} />);
    const el = screen.getByText("₹4.75 Cr");
    expect(el).toHaveAttribute("title", "₹4,75,00,000");
  });

  it("abbreviates a lakh", () => {
    render(<Money value={4_250_000} />);
    expect(screen.getByText("₹42.5 L")).toBeInTheDocument();
  });

  it("spells small amounts in full with Indian grouping", () => {
    render(<Money value={9500} />);
    expect(screen.getByText("₹9,500")).toBeInTheDocument();
  });

  it("renders an em dash for a missing amount", () => {
    render(<Money value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("DateText", () => {
  it("renders IST and keeps UTC in the title", () => {
    render(<DateText value="2026-09-04T18:30:00Z" withTime />);
    const el = screen.getByText("05 Sep 2026, 00:00 IST");
    expect(el).toHaveAttribute("title", "2026-09-04T18:30:00.000Z (UTC)");
  });

  it("renders an em dash for a missing date", () => {
    render(<DateText value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech but announces the table load", () => {
    render(<Skeleton />);
    expect(screen.getByTestId("skeleton")).toHaveAttribute("aria-hidden");
  });

  it("announces a loading table politely", () => {
    render(<SkeletonTable rows={2} columns={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
});

describe("Table", () => {
  const rows = [{ id: "u1", unit: "A-1204", due: 250_000 }];
  it("renders a captioned table with right-aligned numerics", () => {
    render(
      <Table
        caption="Demands due"
        rowKey={(r) => r.id}
        rows={rows}
        columns={[
          { key: "unit", header: "Unit", render: (r) => r.unit },
          { key: "due", header: "Due", numeric: true, render: (r) => <Money value={r.due} /> },
        ]}
      />,
    );
    expect(screen.getByRole("table", { name: "Demands due" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "A-1204" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Due" })).toHaveClass("hf-num");
  });
});

describe("EmptyState", () => {
  it("gives real copy and room for a next action", () => {
    render(<EmptyState title="No demands are due" body="The next milestone triggers on slab 8." />);
    expect(screen.getByRole("heading", { name: "No demands are due" })).toBeInTheDocument();
    expect(screen.getByText("The next milestone triggers on slab 8.")).toBeInTheDocument();
  });
});
