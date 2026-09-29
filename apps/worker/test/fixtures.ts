import { deflateSync, strToU8, zipSync } from "fflate";

/** Builds a tiny valid PDF with one line of text per page. */
export function makePdf(pages: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const objs: string[] = [];
  const n = pages.length;
  // 1 catalog, 2 pages, 3 font, then page/content pairs
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const page = 4 + i * 2;
    const stream = `BT /F1 12 Tf 72 720 Td (${esc(text)}) Tj ET`;
    objs[page] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[page + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++)
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Builds a minimal DOCX with one paragraph per line. */
export function makeDocx(lines: string[]): Uint8Array {
  const body = lines
    .map((l) => `<w:p><w:r><w:t>${xmlEsc(l)}</w:t></w:r></w:p>`)
    .join("");
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(doc),
  });
}

/** A DOCX whose entries use data descriptors (bit 3), like Google Docs or LibreOffice output. */
export function makeDocxWithDescriptors(lines: string[]): Uint8Array {
  const body = lines
    .map((l) => `<w:p><w:r><w:t>${xmlEsc(l)}</w:t></w:r></w:p>`)
    .join("");
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const entries: [string, Uint8Array][] = [
    ["[Content_Types].xml", strToU8(CONTENT_TYPES)],
    ["_rels/.rels", strToU8(RELS)],
    ["word/document.xml", strToU8(doc)],
  ];
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const cat = (...a: Uint8Array[]) => {
    const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
    let at = 0;
    for (const x of a) {
      out.set(x, at);
      at += x.length;
    }
    return out;
  };
  for (const [name, raw] of entries) {
    const data = deflateSync(raw);
    const n = strToU8(name);
    const local = cat(u32(0x04034b50), u16(20), u16(8), u16(8), u16(0), u16(0x21), u32(0), u32(0), u32(0), u16(n.length), u16(0), n, data, u32(0x08074b50), u32(0), u32(data.length), u32(raw.length));
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(8), u16(8), u16(0), u16(0x21), u32(0), u32(data.length), u32(raw.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n));
    parts.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0));
}
