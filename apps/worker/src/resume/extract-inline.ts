import { Inflate, unzipSync } from "fflate";
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

/**
 * Two passes. First the declared sizes (nothing decompressed). Then a real streaming inflate that
 * counts actual output bytes, because declared sizes in a hostile zip can lie. Input is pushed in
 * small slices so one slice can never inflate to more than a few MB before we check.
 */
export function checkDocxZip(bytes: Uint8Array): void {
  let total = 0;
  let count = 0;
  let hasDocument = false;
  let tooBig = false;
  try {
    unzipSync(bytes, {
      filter(file) {
        count += 1;
        total += file.originalSize;
        if (file.originalSize > MAX_ZIP_ENTRY) tooBig = true;
        if (file.name === "word/document.xml") hasDocument = true;
        return false;
      },
    });
  } catch {
    throw unsupported("Not a zip file.");
  }
  if (tooBig || total > MAX_ZIP_TOTAL || count > MAX_ZIP_ENTRIES)
    throw unsupported("The document is too large inside.");
  if (!hasDocument) throw unsupported("Not a Word document.");

  checkCentralDirectory(bytes);
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/**
 * Reads the central directory ourselves (it is what mammoth/JSZip trusts to find each entry) and
 * really inflates every entry it points at, counting actual output bytes. Each entry must have a
 * local header at the recorded offset with the same name; anything odd is refused. Input goes
 * into the inflater in small slices so one slice can never expand to more than a few MB unchecked.
 */
function checkCentralDirectory(bytes: Uint8Array): void {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = new TextDecoder("utf-8", { fatal: false });
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw unsupported("Not a zip file.");
  const entries = u16(v, eocd + 10);
  let pos = u32(v, eocd + 16);
  if (entries === 0xffff || pos === 0xffffffff || entries > MAX_ZIP_ENTRIES)
    throw unsupported("Unsupported zip.");

  let real = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length || u32(v, pos) !== 0x02014b50)
      throw unsupported("Broken zip directory.");
    const method = u16(v, pos + 10);
    const compSize = u32(v, pos + 20);
    const nameLen = u16(v, pos + 28);
    const extraLen = u16(v, pos + 30);
    const commentLen = u16(v, pos + 32);
    const local = u32(v, pos + 42);
    const name = names.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (local + 30 > bytes.length || u32(v, local) !== 0x04034b50)
      throw unsupported("Broken zip entry.");
    const lNameLen = u16(v, local + 26);
    const lExtraLen = u16(v, local + 28);
    const lName = names.decode(bytes.subarray(local + 30, local + 30 + lNameLen));
    const start = local + 30 + lNameLen + lExtraLen;
    if (lName !== name || start + compSize > bytes.length)
      throw unsupported("Broken zip entry.");
    const data = bytes.subarray(start, start + compSize);

    let entry = 0;
    const count = (len: number) => {
      entry += len;
      real += len;
      if (entry > MAX_ZIP_ENTRY || real > MAX_ZIP_TOTAL)
        throw unsupported("The document is too large inside.");
    };
    if (method === 0) count(data.length);
    else if (method === 8) {
      try {
        const inflater = new Inflate((chunk) => count(chunk.length));
        for (let i = 0; i < data.length; i += SLICE)
          inflater.push(data.subarray(i, Math.min(i + SLICE, data.length)), i + SLICE >= data.length);
        if (data.length === 0) inflater.push(new Uint8Array(0), true);
      } catch (e) {
        if (e instanceof ResumeError) throw e;
        throw unsupported("Broken zip entry.");
      }
    } else throw unsupported("Unsupported zip.");
  }
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
      buffer: Buffer.from(bytes),
    });
    return value;
  } catch (e) {
    if (e instanceof ResumeError) throw e;
    throw unsupported("The file could not be read.");
  }
}
