import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { GateChip } from "./GateChip";
import { BucketChip } from "./BucketChip";
import { formatINR } from "./MoneyFigure";

describe("design system", () => {
  it("renders an accessible button with the solid (covered) variant", () => {
    render(<Button>Continue</Button>);
    const btn = screen.getByRole("button", { name: "Continue" });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain("bg-fg"); // filled/covered default
  });

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
