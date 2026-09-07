import { describe, expect, it } from "vitest";
import { prettifyKey, formatCell, pickColumns, scoreCardProps } from "./format";
import type { Score } from "./api";

describe("prettifyKey", () => {
  it("title-cases snake_case and strips _id/_inr suffixes", () => {
    expect(prettifyKey("component_code")).toBe("Component Code");
    expect(prettifyKey("unit_id")).toBe("Unit");
    expect(prettifyKey("amount_inr")).toBe("Amount");
  });
});

describe("formatCell", () => {
  it("renders a dash for null/undefined/empty", () => {
    expect(formatCell("reason", null)).toBe("—");
    expect(formatCell("reason", undefined)).toBe("—");
    expect(formatCell("reason", "")).toBe("—");
  });
  it("formats booleans as Yes/No", () => {
    expect(formatCell("required", true)).toBe("Yes");
    expect(formatCell("required", false)).toBe("No");
  });
  it("formats an *_at/*_date field that parses as a date", () => {
    expect(formatCell("occurred_at", "2026-03-05T00:00:00.000Z")).toBe("5 Mar 2026");
  });
  it("leaves a non-date string with a date-like key untouched", () => {
    expect(formatCell("due_date", "not-a-date")).toBe("not-a-date");
  });
  it("formats money fields with Indian grouping", () => {
    expect(formatCell("amount_inr", 1234567)).toBe("₹12,34,567");
  });
  it("formats a plain number with Indian grouping, no currency symbol", () => {
    expect(formatCell("count", 1234567)).toBe("12,34,567");
  });
  it("summarizes an array as an item count", () => {
    expect(formatCell("gates", [1, 2, 3])).toBe("3 items");
    expect(formatCell("gates", [1])).toBe("1 item");
  });
  it("hides a nested object behind a dash", () => {
    expect(formatCell("payload", { a: 1 })).toBe("—");
  });
});

describe("pickColumns", () => {
  it("hides id-shaped keys and caps at 6 columns", () => {
    const rows = [{ id: "x", unit_id: "u1", booking_number: "BK-1", status: "OPEN", a: 1, b: 2, c: 3, d: 4, e: 5 }];
    const cols = pickColumns(rows);
    expect(cols).not.toContain("id");
    expect(cols).not.toContain("unit_id");
    expect(cols.length).toBeLessThanOrEqual(6);
  });
  it("prefers human-facing fields (number/status) over arbitrary ones", () => {
    const rows = [{ id: "x", z_field: 1, booking_number: "BK-1", status: "OPEN" }];
    const cols = pickColumns(rows);
    expect(cols.indexOf("booking_number")).toBeLessThan(cols.indexOf("z_field"));
    expect(cols.indexOf("status")).toBeLessThan(cols.indexOf("z_field"));
  });
});

describe("scoreCardProps", () => {
  const base: Score = {
    value: 61.4,
    trend: "DOWN",
    drivers: [
      { code: "a", label: "A", contribution: 5, fact: "fact A" },
      { code: "b", label: "B", contribution: -3, fact: "fact B" },
    ],
    confidence: "MEDIUM",
    confidence_reason: "why",
    actions: [],
  };

  it("rounds the value and lowercases confidence", () => {
    const props = scoreCardProps(base);
    expect(props.value).toBe("61");
    expect(props.confidence).toBe("medium");
  });
  it("maps trend direction and picks a driver-count-agnostic label", () => {
    expect(scoreCardProps(base).trend.direction).toBe("down");
    expect(scoreCardProps({ ...base, trend: "UP" }).trend.direction).toBe("up");
    expect(scoreCardProps({ ...base, trend: "FLAT" }).trend.direction).toBe("flat");
  });
  it("pads to exactly 3 drivers when the score has fewer", () => {
    const props = scoreCardProps(base);
    expect(props.drivers).toHaveLength(3);
    expect(props.drivers[2].label).toBe("No further drivers");
  });
  it("maps a positive/negative contribution to positive/negative impact", () => {
    const props = scoreCardProps(base);
    expect(props.drivers[0].impact).toBe("positive");
    expect(props.drivers[1].impact).toBe("negative");
  });
});
