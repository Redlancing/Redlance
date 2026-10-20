import { describe, expect, it } from "vitest";
import { ApiError, errorResponse } from "./errors";

describe("ApiError", () => {
  it.each([
    ["UNAUTHENTICATED", 401],
    ["BAD_ORIGIN", 403],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_INPUT", 400],
    ["RATE_LIMITED", 429],
    ["QUOTA_EXCEEDED", 429],
    ["INSUFFICIENT_CREDITS", 402],
    ["DAILY_LIMIT", 429],
    ["PLAN_EXPIRED", 403],
    ["MAX_VERSIONS", 409],
    ["DRAFT_NOT_READY", 409],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["MATCH_WITHDRAWN", 409],
    ["NO_OTHER_PROJECT", 409],
    ["UNAVAILABLE", 503],
    ["TELEGRAM_UNAVAILABLE", 503],
    ["INTERNAL", 500],
  ] as const)("maps %s to %i", (code, status) => {
    expect(new ApiError(code, "m").status).toBe(status);
  });
});

describe("errorResponse", () => {
  it("uses the standard error shape and passes headers through", async () => {
    const res = errorResponse(
      new ApiError("RATE_LIMITED", "Slow down.", undefined, {
        "Retry-After": "5",
      }),
      "req-1",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Slow down.",
        requestId: "req-1",
      },
    });
  });

  it("includes details when present", async () => {
    const res = errorResponse(
      new ApiError("INVALID_INPUT", "Bad.", [{ path: "email" }]),
      "r",
    );
    expect((await res.json()).error.details).toEqual([{ path: "email" }]);
  });
});
