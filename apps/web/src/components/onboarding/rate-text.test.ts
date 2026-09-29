import { describe, expect, it } from "vitest";
import { parseRateText, rateTextToShow } from "./rate-text";

describe("parseRateText", () => {
  it("treats an empty box or a lone dot as no number", () => {
    expect(parseRateText("")).toBeNull();
    expect(parseRateText(".")).toBeNull();
  });
  it("reads partial decimals", () => {
    expect(parseRateText(".5")).toBe(0.5);
    expect(parseRateText("12.")).toBe(12);
    expect(parseRateText("007")).toBe(7);
  });
});

describe("rateTextToShow", () => {
  it("keeps what was typed while it still means the form's number", () => {
    expect(rateTextToShow(".", null)).toBe(".");
    expect(rateTextToShow(".5", 0.5)).toBe(".5");
    expect(rateTextToShow("12.", 12)).toBe("12.");
    expect(rateTextToShow("007", 7)).toBe("007");
    expect(rateTextToShow("", null)).toBe("");
  });
  it("shows the form's number after a restore or discard changes it", () => {
    expect(rateTextToShow("12.", 40)).toBe("40");
    expect(rateTextToShow(".", 25)).toBe("25");
    expect(rateTextToShow("12", null)).toBe("");
  });
});
