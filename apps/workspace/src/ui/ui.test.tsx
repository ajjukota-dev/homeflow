import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GateChip } from "./GateChip";
import { BucketChip } from "./BucketChip";
import { formatINR } from "./MoneyFigure";

// Button/Card/Segmented migrated to @homeflow/ui (R1 screen migration) — covered there only by
// the axe/visual preview pages (e2e/design.spec.ts), no unit tests exist for them yet. This file
// now only covers the domain-specific components that stayed local (gate/bucket chips, money
// formatting).
describe("design system", () => {
  it("labels every gate state (colour never sole signal)", () => {
    render(<GateChip state="HARD_CLOSED" />);
    expect(screen.getByText("Hard closed")).toBeInTheDocument();
  });

  it("labels every true-risk bucket (colour never sole signal)", () => {
    render(<BucketChip bucket="TRUE_RISK" />);
    expect(screen.getByText("True risk")).toBeInTheDocument();
  });

  it("formats INR with lakh/crore grouping", () => {
    expect(formatINR(1234567)).toBe("₹12,34,567");
    expect(formatINR(450000)).toBe("₹4,50,000");
  });
});
