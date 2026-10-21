import { describe, expect, it, vi } from "vitest";
import type { ImportSummary } from "@/server/onboarding/imports";
import { logImportChanges } from "./import-dev-log";

const job = (over: Partial<ImportSummary>): ImportSummary => ({
  id: "01abcdef-0000",
  kind: "resume",
  status: "running",
  stage: "reading",
  errorCode: null,
  suggestions: null,
  partial: [],
  skipped: [],
  createdAt: "2026-09-29T00:00:00.000Z",
  ...over,
});

const fakeConsole = () => ({ info: vi.fn(), table: vi.fn(), dir: vi.fn() });

describe("logImportChanges", () => {
  it("logs stage changes and the finished job's suggestions in development", () => {
    const out = fakeConsole();
    const done = job({
      status: "done",
      stage: "done",
      suggestions: {
        v: 2,
        basics: { displayName: "A" },
        skills: [{ id: "react", level: "core" }],
        githubUsername: null,
        projects: [],
        experience: [],
      },
    });
    logImportChanges([job({})], [done], out, "development");
    expect(out.info).toHaveBeenCalledWith(
      "[import] resume 01abcdef… → done (was reading)",
    );
    expect(out.dir).toHaveBeenCalledWith(
      expect.objectContaining({ basics: { displayName: "A" } }),
    );
    expect(out.table).toHaveBeenCalledWith([{ id: "react", level: "core" }]);
  });

  it("logs the error code of a failed job", () => {
    const out = fakeConsole();
    const failed = job({
      status: "failed",
      stage: "failed",
      errorCode: "NO_TEXT",
    });
    logImportChanges([job({})], [failed], out, "development");
    expect(out.info).toHaveBeenCalledWith(
      "[import] resume 01abcdef… failed: NO_TEXT",
    );
  });

  it("prints nothing when nothing changed", () => {
    const out = fakeConsole();
    logImportChanges([job({})], [job({})], out, "development");
    expect(out.info).not.toHaveBeenCalled();
  });

  it("prints nothing in production", () => {
    const out = fakeConsole();
    logImportChanges(
      [],
      [job({ status: "failed", stage: "failed" })],
      out,
      "production",
    );
    expect(out.info).not.toHaveBeenCalled();
    expect(out.dir).not.toHaveBeenCalled();
  });
});
