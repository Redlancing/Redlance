import { describe, expect, it } from "vitest";
import { formatMoney, workSummary } from "./review-format";

describe("formatMoney", () => {
  it("formats amounts in the currency", () => {
    expect(formatMoney(50, "USD")).toBe("$50.00");
    expect(formatMoney(12.5, "GBP")).toBe("£12.50");
  });
  it("says Any budget for 0", () => {
    expect(formatMoney(0, "USD")).toBe("Any budget");
  });
});

describe("workSummary", () => {
  const two = [{}, {}];
  it("counts projects and roles", () => {
    expect(
      workSummary({
        projects: two,
        experience: [{}, {}, {}],
        mentionEmployers: false,
      }),
    ).toBe("2 projects · 3 roles · employer names off");
  });
  it("uses singular and shows the switch", () => {
    expect(
      workSummary({ projects: [{}], experience: [], mentionEmployers: true }),
    ).toBe("1 project · 0 roles · employer names on");
  });
  it("says None added for empty lists", () => {
    expect(
      workSummary({ projects: [], experience: [], mentionEmployers: true }),
    ).toBe("None added");
  });
});
