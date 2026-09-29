import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  makeDocx,
  makeDocxWithDescriptors,
  makePdf,
} from "../../test/fixtures";
import { JobError } from "../jobs/types";
import { ResumeError } from "./errors";
import {
  MAX_PDF_PAGES,
  checkDocxZip,
  extractText,
  extractTextInline,
} from "./extract";

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
    const text = await extractText(
      makeDocx(["Jane Doe", "React developer"]),
      "docx",
    );
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

  it("rejects a zip whose declared sizes lie (real inflate is counted)", () => {
    const zip = zipSync({
      "word/document.xml": new Uint8Array(11 * 1024 * 1024),
    });
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let patched = 0;
    for (let i = 0; i + 30 < zip.length; i++) {
      if (v.getUint32(i, true) === 0x04034b50) {
        v.setUint32(i + 22, 100, true);
        patched++;
      } else if (v.getUint32(i, true) === 0x02014b50) {
        v.setUint32(i + 24, 100, true);
        patched++;
      }
    }
    expect(patched).toBe(2);
    expect(zip.length).toBeLessThan(100_000);
    expect(() => checkDocxZip(zip)).toThrow(ResumeError);
  });

  it("rejects a central directory pointing document.xml at another entry", () => {
    const zip = makeDocx(["hello"]);
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const dec = new TextDecoder();
    const cds: { at: number; name: string }[] = [];
    for (let i = 0; i + 46 < zip.length; i++)
      if (v.getUint32(i, true) === 0x02014b50)
        cds.push({
          at: i,
          name: dec.decode(
            zip.subarray(i + 46, i + 46 + v.getUint16(i + 28, true)),
          ),
        });
    const doc = cds.find((c) => c.name === "word/document.xml")!;
    const other = cds.find((c) => c.name !== "word/document.xml")!;
    v.setUint32(doc.at + 42, v.getUint32(other.at + 42, true), true);
    expect(() => checkDocxZip(zip)).toThrow(ResumeError);
  });

  it("extracts text through the rebuilt zip, including data-descriptor DOCX", async () => {
    expect(await extractTextInline(makeDocx(["Plain text"]), "docx")).toContain(
      "Plain text",
    );
    expect(
      await extractTextInline(
        makeDocxWithDescriptors(["Descriptor text"]),
        "docx",
      ),
    ).toContain("Descriptor text");
  });

  // Builds a zip with a real document.xml and an 11 MB bomb stored under another name.
  function bombZip() {
    const zip = zipSync({
      "word/document.xml": strToU8("<w:document/>"),
      "word/document.xmX": new Uint8Array(11 * 1024 * 1024),
    });
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i--)
      if (v.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    return { zip, v, eocd };
  }

  it("rejects an extra central-directory record beyond the announced count", () => {
    const { zip, v, eocd } = bombZip();
    const cdOff = v.getUint32(eocd + 16, true);
    const cd = zip.subarray(cdOff, eocd);
    // last record = the bomb; duplicate it under the real name
    const recs: number[] = [];
    for (let i = 0; i + 4 <= cd.length; i++)
      if (
        new DataView(cd.buffer, cd.byteOffset).getUint32(i, true) === 0x02014b50
      )
        recs.push(i);
    const extra = cd.slice(recs[recs.length - 1]);
    extra.set(strToU8("word/document.xml"), 46);
    const out = new Uint8Array(zip.length + extra.length);
    out.set(zip.subarray(0, eocd));
    out.set(extra, eocd);
    out.set(zip.subarray(eocd), eocd + extra.length);
    expect(zip.length).toBeLessThan(100_000);
    expect(() => checkDocxZip(out)).toThrow(ResumeError);
  });

  it("rejects an understated central directory size", () => {
    const { zip, v, eocd } = bombZip();
    v.setUint32(eocd + 12, v.getUint32(eocd + 12, true) - 10, true);
    expect(() => checkDocxZip(zip)).toThrow(ResumeError);
  });

  it("runs the worker-thread path and inline path to the same result", async () => {
    const pdf = makePdf(["Thread test line"]);
    expect(await extractText(pdf, "pdf")).toContain("Thread test line");
    expect(await extractTextInline(pdf, "pdf")).toContain("Thread test line");
    expect(pdf.length).toBeGreaterThan(0); // caller's buffer not detached
  });

  it("maps a worker that cannot finish in time to UNSUPPORTED_FILE", async () => {
    expect(
      await code(extractText(makePdf(["x"]), "pdf", { timeoutMs: 1 })),
    ).toBe("UNSUPPORTED_FILE");
  });

  function logStub() {
    const calls: unknown[][] = [];
    const log: any = {
      info: (...a: unknown[]) => calls.push(a),
      warn: (...a: unknown[]) => calls.push(a),
      error: (...a: unknown[]) => calls.push(a),
      child: () => log,
    };
    return { log, calls };
  }

  it("logs the timeout path without any message", async () => {
    const { log, calls } = logStub();
    await code(
      extractText(makePdf(["secret line"]), "pdf", { timeoutMs: 1, log }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toMatchObject({ path: "timeout" });
    expect(JSON.stringify(calls)).not.toContain("secret");
  });

  it("maps a thread that cannot start to a retryable INTERNAL, and logs it", async () => {
    const { log, calls } = logStub();
    const err = await extractText(makePdf(["x"]), "pdf", {
      log,
      workerUrl: new URL("file:///nonexistent/extract-worker.ts"),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ code: "INTERNAL", retryable: true });
    expect(calls[0]![0]).toMatchObject({
      path: "error",
      errName: "Error",
      errCode: "ERR_MODULE_NOT_FOUND",
    });
    expect(JSON.stringify(calls)).not.toContain("nonexistent");
  });
});
