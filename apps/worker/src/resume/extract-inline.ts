import { Inflate, unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";
import { ResumeError } from "./errors";

export const MAX_PDF_PAGES = 10;
const MAX_ZIP_TOTAL = 20 * 1024 * 1024;
const MAX_ZIP_ENTRY = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;
const SLICE = 4096;

const unsupported = (message: string) =>
  new ResumeError("UNSUPPORTED_FILE", message);

/** Cheap first filter on declared sizes, then the full structural read (see readDocxEntries). */
export function checkDocxZip(bytes: Uint8Array): void {
  let total = 0;
  let count = 0;
  let tooBig = false;
  try {
    unzipSync(bytes, {
      filter(file) {
        count += 1;
        total += file.originalSize;
        if (file.originalSize > MAX_ZIP_ENTRY) tooBig = true;
        return false;
      },
    });
  } catch {
    throw unsupported("Not a zip file.");
  }
  if (tooBig || total > MAX_ZIP_TOTAL || count > MAX_ZIP_ENTRIES)
    throw unsupported("The document is too large inside.");
  readDocxEntries(bytes);
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/**
 * Reads the zip strictly and returns every entry's really inflated bytes.
 *
 * Structure must be plain: the end-of-central-directory record is the last thing in the file, the
 * central directory ends exactly where it starts, holds exactly the announced number of records,
 * has no duplicate names, and each record points at a local header with the same name. Each entry
 * is inflated in small slices and real output bytes are counted (10 MB per entry, 20 MB total),
 * because declared sizes can lie. The caller rebuilds a clean zip from the result, so the parser
 * that follows sees exactly the bytes counted here, whatever the original file looked like.
 */
function readDocxEntries(bytes: Uint8Array): Record<string, Uint8Array> {
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
  if (
    entries === 0xffff ||
    cdOffset === 0xffffffff ||
    entries > MAX_ZIP_ENTRIES ||
    cdOffset + cdSize !== eocd ||
    eocd + 22 + u16(v, eocd + 20) !== bytes.length
  )
    throw unsupported("Unsupported zip.");

  const files: Record<string, Uint8Array> = {};
  let pos = cdOffset;
  let real = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > eocd || u32(v, pos) !== 0x02014b50)
      throw unsupported("Broken zip directory.");
    const method = u16(v, pos + 10);
    const compSize = u32(v, pos + 20);
    const nameLen = u16(v, pos + 28);
    const extraLen = u16(v, pos + 30);
    const commentLen = u16(v, pos + 32);
    const local = u32(v, pos + 42);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (pos > eocd || name in files) throw unsupported("Broken zip directory.");

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
    else if (method === 8) {
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
    } else throw unsupported("Unsupported zip.");

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

/** A clean, stored-only zip holding exactly the entries that were counted. */
function rebuildDocx(bytes: Uint8Array): Uint8Array {
  return zipSync(readDocxEntries(bytes), { level: 0 });
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
    checkDocxZip(bytes);
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(rebuildDocx(bytes)),
    });
    return value;
  } catch (e) {
    if (e instanceof ResumeError) throw e;
    throw unsupported("The file could not be read.");
  }
}
