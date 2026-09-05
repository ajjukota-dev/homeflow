import { describe, expect, it } from "vitest";
import { parseConditionExpr, validateConditionExpr, evaluateCondition, ConditionExprError } from "./dsl";

describe("journey/dsl", () => {
  it("parses ==/!= with a quoted string value", () => {
    expect(parseConditionExpr('customer.residency == "NRI"')).toEqual({
      scope: "customer",
      field: "residency",
      op: "==",
      value: "NRI",
    });
    expect(parseConditionExpr("booking.status != 'active'")).toEqual({
      scope: "booking",
      field: "status",
      op: "!=",
      value: "active",
    });
  });

  it("parses booleans and numbers unquoted", () => {
    expect(parseConditionExpr("booking.has_change_requests == true")).toMatchObject({ value: true });
    expect(parseConditionExpr("unit.floor_no == 5")).toMatchObject({ value: 5 });
  });

  it("parses in/not in with a bracketed list", () => {
    expect(parseConditionExpr("unit.product_type in [VILLA,PLOT]")).toEqual({
      scope: "unit",
      field: "product_type",
      op: "in",
      value: ["VILLA", "PLOT"],
    });
    expect(parseConditionExpr("project.status not in [CLOSED]")).toMatchObject({
      op: "not in",
      value: ["CLOSED"],
    });
  });

  it("fails closed on garbage instead of defaulting true/false", () => {
    expect(() => parseConditionExpr("this is not an expression")).toThrow(ConditionExprError);
    expect(() => parseConditionExpr("customer.residency >< NRI")).toThrow(ConditionExprError);
    expect(() => parseConditionExpr("nobody.field == 1")).toThrow(ConditionExprError);
    expect(() => parseConditionExpr("unit.product_type in VILLA")).toThrow(ConditionExprError); // missing brackets
  });

  it("validateConditionExpr throws the same way, for a publish-time gate", () => {
    expect(() => validateConditionExpr("garbage")).toThrow(ConditionExprError);
    expect(() => validateConditionExpr("booking.status == 'active'")).not.toThrow();
  });

  it("evaluates against a scoped context", () => {
    const ctx = { booking: { has_change_requests: true }, unit: { product_type: "PLOT" } };
    expect(evaluateCondition("booking.has_change_requests == true", ctx)).toBe(true);
    expect(evaluateCondition("unit.product_type in [VILLA,PLOT]", ctx)).toBe(true);
    expect(evaluateCondition("unit.product_type not in [VILLA,PLOT]", ctx)).toBe(false);
    expect(evaluateCondition("booking.has_change_requests == false", ctx)).toBe(false);
  });
});
