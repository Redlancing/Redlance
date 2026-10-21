import { Inflate, zipSync } from "fflate";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";
import { ResumeError } from "./errors";

// Resumes are 1–3 pages; later pages are never parsed (less work, less memory).
export const MAX_PDF_PAGES = 3;
// Only text XML is counted (images are never unpacked); a real resume's is well under 1 MB.
const MAX_ZIP_TOTAL = 5 * 1024 * 1024;
const MAX_ZIP_ENTRY = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;
const SLICE = 4096;

const unsupported = (message: string) =>
  new ResumeError("UNSUPPORTED_FILE", message);

/**
 * The only zip entries extractRawText opens (mammoth 1.13, lib/docx/docx-reader.js): the content
 * types, the package rels, then the main document and the parts related to it (styles, numbering,
 * footnotes, endnotes, comments), each with its own _rels file. Images are only bound lazily
 * (body-reader.js findEmbeddedImageFile) and never read for raw text. mammoth finds these parts
 * through the rels but falls back to exactly these paths when a target isn't in the zip, so a fixed
 * list is enough: a document whose rels point elsewhere is read from these paths, which are the
 * bytes we counted. Every other entry is checked structurally but never inflated or kept.
 */
const DOCX_PARTS = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/_rels/document.xml.rels",
  "word/styles.xml",
  "word/numbering.xml",
  "word/footnotes.xml",
  "word/_rels/footnotes.xml.rels",
  "word/endnotes.xml",
  "word/_rels/endnotes.xml.rels",
  "word/comments.xml",
  "word/_rels/comments.xml.rels",
]);

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/**
 * Reads the zip strictly and returns the really inflated bytes of the DOCX_PARTS it holds.
 *
 * Structure must be plain for every entry: the end-of-central-directory record is the last thing
 * in the file, the central directory ends exactly where it starts, holds exactly the announced
 * number of records, has no duplicate names, and each record points at a local header with the
 * same name. Only DOCX_PARTS are inflated, in small slices, and their real output bytes are
 * counted (10 MB per entry, 20 MB total), because declared sizes can lie; a declared size over the
 * limit is refused before inflating. Other entries (images, fonts) cost nothing, whatever they hold.
 */
export function checkDocxZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 65535);
    i--
  )
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw unsupported("Not a zip file.");
  const entries = u16(v, eocd + 10);
  const cdSize = u32(v, eocd + 12);
  const cdOffset = u32(v, eocd + 16);
  if (entries > MAX_ZIP_ENTRIES && entries !== 0xffff)
    throw unsupported("The document is too large inside.");
  if (
    entries === 0xffff ||
    cdOffset === 0xffffffff ||
    cdOffset + cdSize !== eocd ||
    eocd + 22 + u16(v, eocd + 20) !== bytes.length
  )
    throw unsupported("Unsupported zip.");

  const names = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  let pos = cdOffset;
  let real = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > eocd || u32(v, pos) !== 0x02014b50)
      throw unsupported("Broken zip directory.");
    const method = u16(v, pos + 10);
    const compSize = u32(v, pos + 20);
    const size = u32(v, pos + 24);
    const nameLen = u16(v, pos + 28);
    const extraLen = u16(v, pos + 30);
    const commentLen = u16(v, pos + 32);
    const local = u32(v, pos + 42);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (pos > eocd || names.has(name))
      throw unsupported("Broken zip directory.");
    names.add(name);

    if (local + 30 > bytes.length || u32(v, local) !== 0x04034b50)
      throw unsupported("Broken zip entry.");
    const lNameLen = u16(v, local + 26);
    const lExtraLen = u16(v, local + 28);
    const lName = decoder.decode(
      bytes.subarray(local + 30, local + 30 + lNameLen),
    );
    const start = local + 30 + lNameLen + lExtraLen;
    if (lName !== name || start + compSize > bytes.length)
      throw unsupported("Broken zip entry.");
    if (method !== 0 && method !== 8) throw unsupported("Unsupported zip.");
    if (!DOCX_PARTS.has(name)) continue;
    if (size > MAX_ZIP_ENTRY)
      throw unsupported("The document is too large inside.");
    const data = bytes.subarray(start, start + compSize);

    let entry = 0;
    const chunks: Uint8Array[] = [];
    const take = (chunk: Uint8Array) => {
      entry += chunk.length;
      real += chunk.length;
      if (entry > MAX_ZIP_ENTRY || real > MAX_ZIP_TOTAL)
        throw unsupported("The document is too large inside.");
      chunks.push(chunk.slice());
    };
    if (method === 0) take(data);
    else {
      try {
        const inflater = new Inflate((chunk) => take(chunk));
        for (let i = 0; i < data.length; i += SLICE)
          inflater.push(
            data.subarray(i, Math.min(i + SLICE, data.length)),
            i + SLICE >= data.length,
          );
        if (data.length === 0) inflater.push(new Uint8Array(0), true);
      } catch (e) {
        if (e instanceof ResumeError) throw e;
        throw unsupported("Broken zip entry.");
      }
    }

    const out = new Uint8Array(entry);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    files[name] = out;
  }
  if (pos !== eocd) throw unsupported("Broken zip directory.");
  if (!("word/document.xml" in files))
    throw unsupported("Not a Word document.");
  return files;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const out: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str + (item.hasEOL ? "\n" : "");
      }
      out.push(line);
    }
    return out.join("\n");
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function extractTextInline(
  bytes: Uint8Array,
  type: "pdf" | "docx",
): Promise<string> {
  try {
    if (type === "pdf") return await pdfText(bytes);
    // mammoth only sees a clean, stored-only zip of the parts counted above.
    const rebuilt = zipSync(checkDocxZip(bytes), { level: 0 });
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(
        rebuilt.buffer,
        rebuilt.byteOffset,
        rebuilt.byteLength,
      ),
    });
    return value;
  } catch (e) {
    if (e instanceof ResumeError) throw e;
    throw unsupported("The file could not be read.");
  }
}
