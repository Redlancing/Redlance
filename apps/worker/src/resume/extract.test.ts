import { randomBytes } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
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
  MEMORY_LIMIT_BYTES,
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

  it("reads at most 3 pages", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => `PageMarker${i + 1}X`);
    const text = await extractText(makePdf(pages), "pdf");
    expect(MAX_PDF_PAGES).toBe(3);
    expect(text).toContain("PageMarker3X");
    expect(text).not.toContain("PageMarker4X");
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

  it("rejects text parts over 5 MB in total, even when each is under the cap", () => {
    const zip = zipSync({
      "word/document.xml": new Uint8Array(3 * 1024 * 1024),
      "word/styles.xml": new Uint8Array(3 * 1024 * 1024),
    });
    expect(() => checkDocxZip(zip)).toThrow(
      "The document is too large inside.",
    );
  });

  it("accepts text parts just under 5 MB", () => {
    const zip = zipSync({
      "word/document.xml": new Uint8Array(4 * 1024 * 1024),
    });
    expect(() => checkDocxZip(zip)).not.toThrow();
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

  // A raw deflate stream (one fixed-Huffman block) that inflates to `matches * 258 + 1` zero
  // bytes: one literal 0, then length-258 distance-1 copies at 13 bits each. Built directly so a
  // 1 GB bomb costs ~7 MB and a few ms, with no 1 GB buffer.
  function zeroBomb(matches: number) {
    const out = new Uint8Array(Math.ceil((3 + 8 + matches * 13 + 7) / 8));
    let bit = 0;
    const put = (b: number) => {
      if (b) out[bit >> 3]! |= 1 << (bit & 7);
      bit++;
    };
    const huff = (code: number, len: number) => {
      for (let i = len - 1; i >= 0; i--) put((code >> i) & 1);
    };
    put(1); // BFINAL
    put(1); // BTYPE = 01 (fixed), low bit first
    put(0);
    huff(0x30, 8); // literal 0
    for (let i = 0; i < matches; i++) {
      huff(0xc5, 8); // length symbol 285 = 258
      huff(0, 5); // distance code 0 = 1
    }
    huff(0, 7); // end of block
    return { data: out, size: matches * 258 + 1 };
  }

  type RawEntry = {
    name: string;
    data: Uint8Array;
    method: 0 | 8;
    size: number;
  };

  // A plain zip written by hand, so an entry can be deflated by us and declare any size.
  function rawZip(entries: RawEntry[]) {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
      const name = strToU8(e.name);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, e.method, true);
      lv.setUint32(18, e.data.length, true);
      lv.setUint32(22, e.size >>> 0, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(10, e.method, true);
      cv.setUint32(20, e.data.length, true);
      cv.setUint32(24, e.size >>> 0, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      parts.push(lh, e.data);
      central.push(ch);
      offset += lh.length + e.data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const all = [...parts, ...central, end];
    const zip = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let at = 0;
    for (const x of all) {
      zip.set(x, at);
      at += x.length;
    }
    return zip;
  }

  // The entries of makeDocx, as stored RawEntries, plus `extra`.
  function docxWith(lines: string[], extra: RawEntry[]) {
    const base = makeDocx(lines);
    const stored: RawEntry[] = [];
    for (const [name, data] of Object.entries(unzipSync(base)))
      stored.push({ name, data, method: 0, size: data.length });
    return rawZip([...stored, ...extra]);
  }

  it("reads a DOCX with a 25 MB photo: images are not unpacked or counted", async () => {
    const photo = randomBytes(25 * 1024 * 1024);
    const zip = zipSync({
      ...unzipSync(makeDocx(["Photo resume"])),
      "word/media/image1.png": [photo, { level: 0 }],
    });
    expect(zip.length).toBeGreaterThan(25 * 1024 * 1024);
    expect(await extractTextInline(zip, "docx")).toContain("Photo resume");
    expect(Object.keys(checkDocxZip(zip))).not.toContain(
      "word/media/image1.png",
    );
  });

  it("ignores a 1 GB deflate bomb in word/media", async () => {
    const bomb = zeroBomb(Math.floor(2 ** 30 / 258));
    expect(bomb.size).toBeGreaterThan(1000 * 1024 * 1024);
    const zip = docxWith(
      ["Bomb beside me"],
      [{ name: "word/media/image1.png", method: 8, ...bomb }],
    );
    const t = Date.now();
    expect(await extractTextInline(zip, "docx")).toContain("Bomb beside me");
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("refuses a deflate bomb in an allowlisted part, by real bytes and by declared size", () => {
    const bomb = zeroBomb(50_000); // ~12.9 MB of zeros
    const parts = Object.entries(unzipSync(makeDocx(["x"])));
    for (const name of ["word/document.xml", "word/styles.xml"])
      for (const size of [bomb.size, 100]) {
        const zip = rawZip([
          ...parts
            .filter(([n]) => n !== name)
            .map(([n, data]): RawEntry => ({
              name: n,
              data,
              method: 0,
              size: data.length,
            })),
          { name, method: 8, data: bomb.data, size },
        ]);
        expect(() => checkDocxZip(zip)).toThrow(
          "The document is too large inside.",
        );
      }
  });

  it("still checks the structure of entries it doesn't unpack", () => {
    const photo: RawEntry = {
      name: "word/media/image1.png",
      data: strToU8("png"),
      method: 0,
      size: 3,
    };
    expect(() => checkDocxZip(docxWith(["x"], [photo]))).not.toThrow();
    // a duplicate name
    expect(() => checkDocxZip(docxWith(["x"], [photo, photo]))).toThrow(
      "Broken zip directory.",
    );
    // an unknown compression method
    expect(() =>
      checkDocxZip(docxWith(["x"], [{ ...photo, method: 12 as 0 }])),
    ).toThrow("Unsupported zip.");
    // a local header whose name differs from the central record
    const zip = docxWith(["x"], [photo]);
    const at = Buffer.from(zip).indexOf("word/media/image1.png");
    zip[at + 11] = "X".charCodeAt(0); // the first (local) copy only
    expect(() => checkDocxZip(zip)).toThrow("Broken zip entry.");
    // data running past the end of the file
    const big = docxWith(["x"], [photo]);
    const v = new DataView(big.buffer);
    const cd = v.getUint32(big.length - 22 + 16, true);
    let rec = cd;
    for (let i = 0; i < 3; i++) rec += 46 + v.getUint16(rec + 28, true);
    v.setUint32(rec + 20, 1_000_000, true);
    expect(() => checkDocxZip(big)).toThrow("Broken zip entry.");
  });

  it("gives mammoth every part it reads, so text matches reading the original", async () => {
    const W =
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const R =
      'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
    const rel = (id: string, type: string, target: string) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    const files: Record<string, Uint8Array> = {
      ...unzipSync(makeDocx(["x"])),
      "word/document.xml": strToU8(
        `<?xml version="1.0"?><w:document ${W}><w:body>` +
          `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Jane Doe</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Built a React app</w:t></w:r>` +
          `<w:r><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>After the photo</w:t></w:r></w:p>` +
          `</w:body></w:document>`,
      ),
      "word/_rels/document.xml.rels": strToU8(
        `<?xml version="1.0"?><Relationships ${R}>` +
          rel("rId1", "styles", "styles.xml") +
          rel("rId2", "numbering", "numbering.xml") +
          rel("rId3", "footnotes", "footnotes.xml") +
          rel("rId9", "image", "media/image1.png") +
          `</Relationships>`,
      ),
      "word/styles.xml": strToU8(
        `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
      ),
      "word/numbering.xml": strToU8(
        `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      ),
      "word/footnotes.xml": strToU8(
        `<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>A footnote</w:t></w:r></w:p></w:footnote></w:footnotes>`,
      ),
      "word/media/image1.png": randomBytes(1024),
    };
    const original = zipSync(files);
    const direct = await mammoth.extractRawText({
      buffer: Buffer.from(original),
    });
    const ours = await extractTextInline(original, "docx");
    expect(ours).toBe(direct.value);
    expect(ours).toContain("Jane Doe");
    expect(ours).toContain("Built a React app");
    expect(ours).toContain("After the photo");
    expect(Object.keys(checkDocxZip(original)).sort()).toEqual(
      Object.keys(files)
        .filter((n) => n !== "word/media/image1.png")
        .sort(),
    );
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

  describe("memory watchdog", () => {
    const hog = new URL("../../test/memory-hog-worker.ts", import.meta.url);
    const mode = (m: "sync" | "async") => new TextEncoder().encode(m);

    for (const m of ["sync", "async"] as const)
      it(`stops a thread whose ArrayBuffers pass the limit (${m} allocator)`, async () => {
        const { log, calls } = logStub();
        const rssBefore = process.memoryUsage().rss;
        const started = Date.now();
        expect(
          await code(extractText(mode(m), "pdf", { log, workerUrl: hog })),
        ).toBe("UNSUPPORTED_FILE");
        expect(Date.now() - started).toBeLessThan(3_000); // well before the 5 s timer
        // The hog wants 2 GB; stopped near the 128 MB limit, the process stays far below that.
        expect(process.memoryUsage().rss - rssBefore).toBeLessThan(
          768 * 1024 * 1024,
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]![0]).toMatchObject({ path: "memory" });
        expect((calls[0]![0] as { memoryMb: number }).memoryMb).toBeGreaterThan(
          MEMORY_LIMIT_BYTES / 1024 / 1024,
        );
      });

    it("stops only the hog when another extraction runs at the same time", async () => {
      const [bad, good] = await Promise.all([
        code(extractText(mode("sync"), "pdf", { workerUrl: hog })),
        extractText(makePdf(["Still fine next door"]), "pdf"),
      ]);
      expect(bad).toBe("UNSUPPORTED_FILE");
      expect(good).toContain("Still fine next door");
    });

    it("lets normal PDF and DOCX extractions finish without firing", async () => {
      const { log, calls } = logStub();
      expect(
        await extractText(makePdf(["Normal pdf"]), "pdf", { log }),
      ).toContain("Normal pdf");
      expect(
        await extractText(makeDocx(["Normal docx"]), "docx", { log }),
      ).toContain("Normal docx");
      expect(calls).toHaveLength(0);
    });
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
