import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeDocx, makePdf } from "../../test/fixtures";
import { ResumeError } from "./errors";
import { MAX_PDF_PAGES, checkDocxZip, extractText } from "./extract";

const code = async (p: Promise<unknown> | (() => void)) => {
  try {
    if (typeof p === "function") p();
    else await p;
  } catch (e) {
    return e instanceof ResumeError ? e.code : `other:${String(e)}`;
  }
  return "none";
};

describe("extractText", () => {
  it("reads a PDF", async () => {
    const text = await extractText(makePdf(["Hello resume world"]), "pdf");
    expect(text).toContain("Hello resume world");
  });

  it("reads at most 10 pages", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => `PageMarker${i + 1}X`);
    const text = await extractText(makePdf(pages), "pdf");
    expect(MAX_PDF_PAGES).toBe(10);
    expect(text).toContain("PageMarker10X");
    expect(text).not.toContain("PageMarker11X");
  });

  it("reads a DOCX", async () => {
    const text = await extractText(makeDocx(["Jane Doe", "React developer"]), "docx");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("React developer");
  });

  it("rejects a zip without word/document.xml", async () => {
    const zip = zipSync({ "a.txt": strToU8("hi") });
    expect(await code(extractText(zip, "docx"))).toBe("UNSUPPORTED_FILE");
  });

  it("rejects a zip bomb without decompressing it", () => {
    const zip = zipSync({
      "word/document.xml": new Uint8Array(11 * 1024 * 1024),
    });
    expect(zip.length).toBeLessThan(100_000);
    expect(() => checkDocxZip(zip)).toThrow(ResumeError);
  });

  it("rejects too many entries", () => {
    const files: Record<string, Uint8Array> = {
      "word/document.xml": strToU8("<a/>"),
    };
    for (let i = 0; i < 1001; i++) files[`f${i}.txt`] = strToU8("x");
    expect(() => checkDocxZip(zipSync(files))).toThrow(ResumeError);
  });

  it("accepts a valid docx zip", () => {
    expect(() => checkDocxZip(makeDocx(["x"]))).not.toThrow();
  });

  it("rejects random bytes as pdf or docx", async () => {
    const junk = new Uint8Array(500).map((_, i) => (i * 37) % 251);
    expect(await code(extractText(junk, "pdf"))).toBe("UNSUPPORTED_FILE");
    expect(await code(extractText(junk, "docx"))).toBe("UNSUPPORTED_FILE");
  });
});
