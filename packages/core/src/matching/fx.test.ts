import { describe, expect, it } from "vitest";
import { convert, FX_TO_USD } from "./fx";

describe("convert", () => {
  it("is the identity for the same currency", () => {
    expect(convert(50, "USD", "USD")).toBe(50);
  });
  it("turns GBP into more USD", () => {
    expect(convert(10, "GBP", "USD")!).toBeGreaterThan(10);
  });
  it("uses FX_TO_USD", () => {
    expect(convert(1000, "INR", "USD")).toBeCloseTo(1000 * FX_TO_USD.INR);
  });
  it("returns null for an unknown currency", () => {
    expect(convert(1, "XYZ", "USD")).toBeNull();
    expect(convert(1, "USD", "XYZ")).toBeNull();
  });
});
