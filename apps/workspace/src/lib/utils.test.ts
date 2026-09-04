import { describe, expect, it } from "vitest";
import { formatIstDateTime } from "./utils";

describe("formatIstDateTime", () => {
  it("renders an ISO timestamp in IST as spec'd for Acted stamps (H11)", () => {
    expect(formatIstDateTime("2026-09-04T21:11:00.000Z")).toBe("5 Sep 2026, 02:41");
  });
});
