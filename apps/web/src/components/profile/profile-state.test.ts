import { describe, expect, it } from "vitest";
import type { ApiFail } from "@/lib/api-client";
import {
  canStartEdit,
  exhausted,
  fieldErrorsFrom,
  saveFailure,
  savedToast,
} from "./profile-state";

const fail = (code: string, details?: unknown, status = 400): ApiFail => ({
  ok: false,
  status,
  code,
  message: "",
  details,
});

describe("fieldErrorsFrom", () => {
  it("strips the data prefix and drops junk", () => {
    expect(
      fieldErrorsFrom([
        { path: "data.categories", message: "Pick one." },
        { path: "data", message: "Bad." },
        { nope: true },
        "x",
      ]),
    ).toEqual([
      { path: "categories", message: "Pick one." },
      { path: "", message: "Bad." },
    ]);
    expect(fieldErrorsFrom(undefined)).toEqual([]);
  });
});

describe("saveFailure", () => {
  it("shows field errors next to the fields", () => {
    expect(
      saveFailure(
        fail("INVALID_INPUT", [{ path: "data.minRate", message: "No." }]),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [{ path: "minRate", message: "No." }],
    });
  });

  it("falls back to a message for INVALID_INPUT without field errors", () => {
    expect(saveFailure(fail("INVALID_INPUT"))).toMatchObject({
      kind: "error",
    });
  });

  it("says when the next change frees up after a limit refusal", () => {
    const res = saveFailure(
      fail(
        "PROFILE_EDIT_LIMIT",
        { limit: 5, nextFreeAt: "2026-10-22T12:00:00.000Z" },
        429,
      ),
      "UTC",
    );
    expect(res).toEqual({
      kind: "limit",
      nextFreeAt: "2026-10-22T12:00:00.000Z",
      message:
        "You've used all your profile changes for this week. Next one frees up Thu, Oct 22, 12:00 PM.",
    });
    expect(saveFailure(fail("PROFILE_EDIT_LIMIT", {}, 429))).toMatchObject({
      kind: "limit",
      nextFreeAt: null,
      message: expect.stringContaining("all 5 profile changes"),
    });
  });

  it("maps conflicts and other errors", () => {
    expect(saveFailure(fail("VERSION_CONFLICT", undefined, 409))).toEqual({
      kind: "conflict",
    });
    expect(saveFailure(fail("NETWORK", undefined, 0))).toEqual({
      kind: "error",
      message: "Can't reach Redlance. Check your connection.",
    });
  });
});

describe("allowance helpers", () => {
  const a = { limit: 5, used: 2, remaining: 3, nextFreeAt: "x" };

  it("marks the allowance used up, keeping a known time", () => {
    expect(exhausted(a, "y")).toEqual({
      limit: 5,
      used: 5,
      remaining: 0,
      nextFreeAt: "y",
    });
    expect(exhausted(a, null).nextFreeAt).toBe("x");
  });

  it("allows starting an edit only with a change left", () => {
    expect(canStartEdit(a)).toBe(true);
    expect(canStartEdit({ ...a, remaining: 0 })).toBe(false);
  });

  it("tells a counted save from a no-op", () => {
    expect(savedToast({ changed: true })).toBe("Profile updated");
    expect(savedToast({ changed: false })).toMatch(/wasn't counted/);
  });
});
