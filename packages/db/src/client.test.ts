import { describe, expect, it, vi } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  it("handles idle-client errors instead of crashing the process", async () => {
    const onError = vi.fn();
    const { pool } = createDb(
      "postgres://redlance:redlance@127.0.0.1:5432/redlance_test",
      { onError },
    );
    expect(() =>
      pool.emit(
        "error",
        new Error("terminating connection due to administrator command"),
      ),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    await pool.end();
  });

  it("has a default handler when none is given", async () => {
    const { pool } = createDb(
      "postgres://redlance:redlance@127.0.0.1:5432/redlance_test",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
    spy.mockRestore();
    await pool.end();
  });
});
