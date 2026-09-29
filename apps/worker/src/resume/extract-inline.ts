import { Unzip, UnzipInflate, unzipSync } from "fflate";
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

  let real = 0;
  let over = false;
  const unzip = new Unzip((file) => {
    let entry = 0;
    file.ondata = (err, chunk) => {
      if (err) {
        over = true;
        return;
      }
      entry += chunk.length;
      real += chunk.length;
      if (entry > MAX_ZIP_ENTRY || real > MAX_ZIP_TOTAL) {
        over = true;
        file.terminate();
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let i = 0; i < bytes.length && !over; i += SLICE)
      unzip.push(bytes.subarray(i, Math.min(i + SLICE, bytes.length)), false);
    if (!over) unzip.push(new Uint8Array(0), true);
  } catch {
    over = true;
  }
  if (over) throw unsupported("The document is too large inside.");
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
