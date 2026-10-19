import { findRanges, type DateRange } from "./dates";
import { projectLinks } from "./prepass";

/**
 * Splits a resume section into entry blocks (one per job or project), so the
 * model can name the block an entry came from ("E2") and code can attach the
 * dates, year and links and check everything against that block alone.
 * Pure, no model.
 */

export type EntryKind = "experience" | "projects";

export type Block = {
  /** "E1".."En" or "P1".."Pn". */
  id: string;
  /** The block's lines exactly as in the resume (blank lines kept inside). */
  text: string;
  /** The block's first date range. */
  range: DateRange | null;
  /** Projects only: the range's end year (this year if current), else the latest plain year. */
  year: number | null;
  /** Projects only: up to 3 links, checked for format and never fetched. */
  links: string[];
};

export const MAX_BLOCKS = 12;
export const MAX_BLOCK_CHARS = 3_000;
/** A longer line that isn't a bullet is body text, not a title or company line. */
export const MAX_HEAD_CHARS = 120;
/** A title-like line (one that can move down into the next block): short, no closing punctuation. */
const MAX_TITLE_CHARS = 60;
/** How many title lines can sit above a dated line ("Senior Developer" / "Acme Corp" / "2021 – 2023"). */
const MAX_LEAD_LINES = 2;

// "-", "–", "•", "▪", "◦", "●", other glyphs PDFs use, private-use symbol-font
// bullets, and "1." / "1)" (followed by a space, so "3.5 years" isn't one).
const BULLET_RE = /^(?:[-–—•*▪◦●■□○·‣⁃➢►▶✓✔❖-]|\d{1,2}[.)](?=\s))/u;

/** A plain year: not part of a word, a number, a version, a price or a count ("2000+ users"). */
const PLAIN_YEAR =
  /(?<![\p{L}\p{N}_.\-$€£₹#])(\d{4})(?![\p{L}\p{N}+%]|[.\-/]\d)/gu;

type LineKind = "blank" | "bullet" | "long" | "head";

function kindOf(line: string): LineKind {
  const t = line.trim();
  if (!t) return "blank";
  if (BULLET_RE.test(t)) return "bullet";
  if (t.length > MAX_HEAD_CHARS) return "long";
  return "head";
}

export function splitEntries(
  section: string,
  kind: EntryKind,
  opts: { headed?: boolean; now?: Date } = {},
): Block[] {
  const headed = opts.headed ?? true;
  const now = opts.now ?? new Date();
  // Without a Projects heading, projects can't be told apart from jobs.
  if (!headed && kind === "projects") return [];

  const lines = section.split("\n");
  const kinds = lines.map(kindOf);
  const trimmed = lines.map((l) => l.trim());
  const dated = lines.map(
    (l, i) => kinds[i] !== "blank" && findRanges(l, now).length > 0,
  );
  const firstLine = kinds.findIndex((k) => k !== "blank");
  if (firstLine < 0) return [];

  // DOCX text (mammoth) has a blank line after every paragraph. When nearly
  // every line is followed by one, a single blank line is just a line break
  // and it takes two to separate entries.
  let gaps = 0;
  let spaced = 0;
  for (let i = firstLine, blanks = 0; i < lines.length; i++) {
    if (kinds[i] === "blank") blanks++;
    else {
      if (i > firstLine) {
        gaps++;
        if (blanks > 0) spaced++;
      }
      blanks = 0;
    }
  }
  const separator = gaps >= 3 && spaced / gaps >= 0.75 ? 2 : 1;

  const titleLike = (i: number) =>
    kinds[i] === "head" &&
    !dated[i] &&
    trimmed[i]!.length <= MAX_TITLE_CHARS &&
    !trimmed[i]!.includes("@") &&
    !/[.!?;:,]$/.test(trimmed[i]!);

  /**
   * Walks back from `start` over up to `max` title-like lines (blank lines
   * shorter than a separator are skipped), never reaching `floor`.
   */
  const pullBack = (start: number, floor: number, max: number) => {
    let s = start;
    let count = 0;
    while (count < max) {
      let k = s - 1;
      let blanks = 0;
      while (k > floor && kinds[k] === "blank") {
        k--;
        blanks++;
      }
      if (blanks >= separator || k <= floor || !titleLike(k)) break;
      s = k;
      count++;
    }
    return { start: s, count };
  };

  // The first entry shows whether titles sit above the date line; later
  // entries are assumed to follow the same format.
  const firstDated = dated.indexOf(true);
  const lead =
    firstDated < 0 ? 0 : pullBack(firstDated, -1, MAX_LEAD_LINES).count;

  /** A short line after a bullet that finishes the bullet's sentence, not a new entry. */
  const continues = (i: number, prev: number) =>
    !dated[i] &&
    !/[.!?]$/.test(trimmed[prev]!) &&
    (/^\p{Ll}/u.test(trimmed[i]!) || /[.!?]$/.test(trimmed[i]!));

  const mainStarts = (): number[] => {
    const starts = [firstLine];
    let hasRange = dated[firstLine]!;
    let content = kinds[firstLine] !== "head"; // the last line was a bullet or body text
    let prev = firstLine;
    let blanks = 0;
    for (let i = firstLine + 1; i < lines.length; i++) {
      if (kinds[i] === "blank") {
        blanks++;
        continue;
      }
      const afterSeparator = blanks >= separator;
      blanks = 0;
      let begin = false;
      let isContinuation = false;
      if (kinds[i] === "head") {
        if (afterSeparator) begin = true;
        else if (content) {
          isContinuation = continues(i, prev);
          begin = !isContinuation;
        } else if (kind === "experience" && dated[i] && hasRange) {
          // A second dated header line: take the title lines above it too.
          starts.push(pullBack(i, starts.at(-1)!, lead).start);
          hasRange = true;
          content = false;
          prev = i;
          continue;
        }
      }
      if (begin) {
        starts.push(i);
        hasRange = dated[i]!;
      } else hasRange ||= dated[i]!;
      content = kinds[i] !== "head" || isContinuation;
      prev = i;
    }
    return starts;
  };

  /** Fallback: a block starts at every line holding a date range (plus its title lines). */
  const dateStarts = (keepPreamble: boolean): number[] | null => {
    if (firstDated < 0) return null;
    const starts = [
      keepPreamble ? firstLine : pullBack(firstDated, -1, lead).start,
    ];
    for (let i = firstDated + 1; i < lines.length; i++)
      if (dated[i]) starts.push(pullBack(i, starts.at(-1)!, lead).start);
    return starts;
  };

  let starts: number[];
  if (!headed) starts = dateStarts(false) ?? [firstLine];
  else {
    starts = mainStarts();
    if (kind === "experience" && starts.length <= 1) {
      const byDate = dateStarts(true);
      if (byDate && byDate.length > 1) starts = byDate;
    }
  }

  // Past the cap, the remaining entries stay in the last block.
  starts = starts.slice(0, MAX_BLOCKS);
  const prefix = kind === "experience" ? "E" : "P";
  return starts.map((start, n) => {
    const raw = lines
      .slice(start, starts[n + 1] ?? lines.length)
      .join("\n")
      .trim();
    const chars = Array.from(raw);
    const text =
      chars.length > MAX_BLOCK_CHARS
        ? chars.slice(0, MAX_BLOCK_CHARS).join("")
        : raw;
    const range = findRanges(text, now)[0] ?? null;
    return {
      id: `${prefix}${n + 1}`,
      text,
      range,
      year: kind === "projects" ? projectYear(text, range, now) : null,
      links: kind === "projects" ? projectLinks(text) : [],
    };
  });
}

/**
 * A project's year: the end year of its first range (this year if current), else the latest
 * plain year in the text, else null.
 */
export function projectYear(
  text: string,
  range: DateRange | null,
  now: Date,
): number | null {
  if (range) return range.end?.year ?? now.getUTCFullYear();
  const max = now.getUTCFullYear() + 1;
  let best: number | null = null;
  for (const m of text.matchAll(PLAIN_YEAR)) {
    const y = Number(m[1]);
    if (y >= 1950 && y <= max && (best === null || y > best)) best = y;
  }
  return best;
}
