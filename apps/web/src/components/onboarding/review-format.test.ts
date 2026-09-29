import { describe, expect, it } from "vitest";
import { formatMoney } from "./review-format";

describe("formatMoney", () => {
  it("formats amounts in the currency", () => {
    expect(formatMoney(50, "USD")).toBe("$50.00");
    expect(formatMoney(12.5, "GBP")).toBe("£12.50");
  });
  it("says Any budget for 0", () => {
    expect(formatMoney(0, "USD")).toBe("Any budget");
  });
});
