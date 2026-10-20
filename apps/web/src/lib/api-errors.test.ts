import { describe, expect, it } from "vitest";
import { errorMessage } from "./api-errors";

describe("errorMessage", () => {
  it("uses the table entry for a known code", () => {
    expect(errorMessage({ code: "NETWORK" })).toMatch(/Can't reach Redlance/);
    expect(errorMessage({ code: "PLAN_EXPIRED", message: "server" })).toBe(
      "Your trial has ended.",
    );
  });

  it("fills in the retry time", () => {
    expect(errorMessage({ code: "RATE_LIMITED", retryAfter: 12 })).toBe(
      "Too many requests. Try again in 12 seconds.",
    );
    expect(errorMessage({ code: "RATE_LIMITED", retryAfter: 1 })).toContain(
      "1 second.",
    );
  });

  it("drops the number when there is no Retry-After", () => {
    expect(errorMessage({ code: "RATE_LIMITED" })).toBe(
      "Too many requests. Try again in a moment.",
    );
  });

  it("falls back to the server message, then a generic one", () => {
    expect(errorMessage({ code: "WEIRD", message: " Custom. " })).toBe(
      "Custom.",
    );
    expect(errorMessage({ code: "WEIRD" })).toBe(
      "Something went wrong. Please try again.",
    );
    expect(errorMessage({ code: "WEIRD", message: "" })).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
