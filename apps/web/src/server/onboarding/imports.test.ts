import { describe, expect, it } from "vitest";
import { sniffFileType, toImportSummary } from "./imports";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("sniffFileType", () => {
  it("recognises PDF and zip headers only", () => {
    expect(sniffFileType(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("pdf");
    expect(sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe("docx");
    expect(sniffFileType(bytes(0x4d, 0x5a, 0x90, 0))).toBeNull();
    expect(sniffFileType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
    expect(sniffFileType(new Uint8Array())).toBeNull();
  });
});

describe("toImportSummary", () => {
  const base = {
    id: "0198a1b2-0000-7000-8000-000000000001",
    userId: "u",
    kind: "resume" as const,
    status: "done" as const,
    stage: "done" as const,
    fileType: "pdf" as const,
    input: {},
    contentHash: null,
    pipelineVersion: null,
    errorCode: null,
    attempts: 1,
    runAfter: new Date(),
    lockedAt: null,
    createdAt: new Date("2026-09-29T00:00:00Z"),
    finishedAt: null,
  };
  it("keeps valid suggestions and reports partial steps", () => {
    const s = toImportSummary({
      ...base,
      result: {
        v: 1,
        meta: { pipelineVersion: "x", promptVersions: {}, partial: ["skills"] },
      },
    });
    expect(s.suggestions?.v).toBe(1);
    expect(s.partial).toEqual(["skills"]);
    expect(s.createdAt).toBe("2026-09-29T00:00:00.000Z");
  });
  it("exposes whether a GitHub import came from the resume", () => {
    const gh = { ...base, kind: "github" as const, result: null };
    expect(
      toImportSummary({
        ...gh,
        input: { username: "octocat", fromResume: true },
      }).fromResume,
    ).toBe(true);
    expect(
      toImportSummary({ ...gh, input: { username: "octocat" } }).fromResume,
    ).toBe(false);
  });
  it("drops an invalid result", () => {
    const s = toImportSummary({ ...base, result: { v: 2, junk: true } });
    expect(s.suggestions).toBeNull();
    expect(s.partial).toEqual([]);
  });
});
