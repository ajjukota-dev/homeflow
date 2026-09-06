import { describe, it, expect } from "vitest";
import { percentOf, average, sum, ratePer, forecastAccuracy } from "./math";

describe("percentOf", () => {
  it("computes a percentage", () => {
    expect(percentOf(45, 90).value).toBe(50);
  });
  it("returns null (not 0) with no denominator — honest no-data", () => {
    expect(percentOf(0, 0).value).toBeNull();
  });
});

describe("average", () => {
  it("averages a list", () => {
    expect(average([1, 2, 3]).value).toBe(2);
  });
  it("returns null for an empty list", () => {
    expect(average([]).value).toBeNull();
  });
});

describe("sum", () => {
  it("sums a list and reports the count as denominator", () => {
    const r = sum([10, 20, 30]);
    expect(r.value).toBe(60);
    expect(r.denominator).toBe(3);
  });
});

describe("ratePer", () => {
  it("computes a rate per N base units (e.g. escalations per 100 customers)", () => {
    expect(ratePer(5, 100, 50).value).toBe(10);
  });
  it("returns null with a zero base", () => {
    expect(ratePer(5, 100, 0).value).toBeNull();
  });
});

describe("forecastAccuracy", () => {
  it("is 100% when forecast exactly matches actual", () => {
    expect(forecastAccuracy(100, 100).value).toBe(100);
  });
  it("degrades with error, clamped at 0 rather than going negative", () => {
    expect(forecastAccuracy(0, 100).value).toBe(0);
    expect(forecastAccuracy(300, 100).value).toBe(0);
  });
  it("returns null when actual is 0 (division has no meaning)", () => {
    expect(forecastAccuracy(100, 0).value).toBeNull();
  });
});
