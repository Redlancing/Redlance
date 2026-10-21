import { findRanges, type DateRange } from "./dates";
import { projectLinks } from "./prepass";

/**
 * Numbers the lines of the Projects and Experience sections for the work call. The model
 * answers each entry's first and last line number, and code turns that range into the
 * entry's block: the text every check runs against, and where its dates, year and links
 * come from. Pure, no model.
 */

export type EntryKind = "experience" | "projects";

/** Keeps the work prompt bounded; a longer section is cut with a note. */
export const MAX_SECTION_CHARS = 12_000;
export const MAX_SECTION_LINES = 300;
/** Shown (unnumbered) where a section was cut. */
export const CUT_NOTE = "(the section is cut here)";

/** A section's numbered lines, as the work call sees them. */
export type SectionLines = {
  kind: EntryKind;
  /** "P" for projects, "E" for experience: line 3 is shown as "[P3]". */
  prefix: "P" | "E";
  /** The numbered lines, trimmed, with marker lookalikes escaped: `lines[0]` is line 1. */
  lines: string[];
  /** The prompt text: every line after its number; blank lines kept (at most one in a row), unnumbered. */
  text: string;
  truncated: boolean;
};

/** One entry's lines and what code takes from them. */
export type Block = {
  /** "P3–P7" for a range, or "projects" / "experience" for the whole section (fallback). */
  id: string;
  /** The entry's lines, joined with "\n". */
  text: string;
  /** The first date range in the lines (null for the whole-section fallback). */
  range: DateRange | null;
  /** Projects only: the range's end year (this year if current), else the latest plain year. */
  year: number | null;
  /** Projects only: up to 3 links, checked for format and never fetched. */
  links: string[];
};

/**
 * Anything in the resume that reads like a line marker ("[P5]", "[ E 12 ]", "【L3】",
 * "［P5］") gets round brackets, so the text can't forge a line number. Citations like "[1]"
 * change too, which is harmless.
 */
const MARKER_LOOKALIKE =
  /[[［【]\s*([A-Za-z]{0,3}\s*[-–]?\s*\d{1,4})\s*[\]］】]/g;
export const escapeMarkers = (line: string) =>
  line.replace(MARKER_LOOKALIKE, "($1)");

/** The model sometimes copies our marker into a value: "[P3] Built X" → "Built X". */
export const stripMarker = (s: string) =>
  s.replace(/^\s*\[[PE]\d{1,4}\]\s*/, "");

/**
 * The section's lines, numbered from 1. Returns null when there is nothing to number, or for
 * projects when the resume has no headings (projects can't be told apart from jobs then).
 */
export function numberSection(
  section: string,
  kind: EntryKind,
  opts: { headed?: boolean } = {},
): SectionLines | null {
  if (kind === "projects" && !(opts.headed ?? true)) return null;
  const prefix = kind === "projects" ? "P" : "E";
  const lines: string[] = [];
  const shown: string[] = [];
  let chars = 0;
  let truncated = false;
  for (const raw of section.split("\n")) {
    const t = escapeMarkers(raw.trim());
    if (!t) {
      if (shown.length && shown.at(-1) !== "") shown.push("");
      continue;
    }
    if (lines.length >= MAX_SECTION_LINES || chars >= MAX_SECTION_CHARS) {
      truncated = true;
      break;
    }
    const room = MAX_SECTION_CHARS - chars;
    const kept = t.length > room ? Array.from(t).slice(0, room).join("") : t;
    if (kept !== t) truncated = true;
    lines.push(kept);
    chars += kept.length;
    shown.push(`[${prefix}${lines.length}] ${kept}`);
    if (truncated) break;
  }
  if (lines.length === 0) return null;
  while (shown.at(-1) === "") shown.pop();
  if (truncated) shown.push(CUT_NOTE);
  return { kind, prefix, lines, text: shown.join("\n"), truncated };
}

/** "P3–P7" (or "P3" for one line). */
export const rangeLabel = (s: SectionLines, from: number, to: number) =>
  from === to ? `${s.prefix}${from}` : `${s.prefix}${from}–${s.prefix}${to}`;

/** The block of lines `from`..`to` (1-based, inclusive; the caller checks the range). */
export function blockFor(
  s: SectionLines,
  from: number,
  to: number,
  now: Date = new Date(),
): Block {
  const text = s.lines.slice(from - 1, to).join("\n");
  const range = findRanges(text, now)[0] ?? null;
  return {
    id: rangeLabel(s, from, to),
    text,
    range,
    year: s.kind === "projects" ? projectYear(text, range, now) : null,
    links: s.kind === "projects" ? projectLinks(text) : [],
  };
}

/**
 * The fallback for an entry whose range can't be used: checked against the whole section,
 * with no dates, year or links (the section's first ones belong to some other entry).
 */
export function wholeSection(s: SectionLines): Block {
  return {
    id: s.kind,
    text: s.lines.join("\n"),
    range: null,
    year: null,
    links: [],
  };
}

/** The model's answer for an entry: its first and last line number (1-based, inclusive). */
export type LineRange = { from: number; to: number };

/** How code reads one entry's range. */
export type ResolvedRange =
  /** `from` is null for the whole-section fallback. */
  | { ok: true; block: Block; from: number | null; notes: string[] }
  | { ok: false; reason: string };

/**
 * Checks the model's ranges for one list, in the model's order:
 * - not whole numbers, starting outside the section, or ending before they start: the entry
 *   is checked against the whole section instead (looser, no dates, year or links), noted;
 * - ending past the section: cut at its last line, noted;
 * - entries are put in line order; when one starts inside the one before, the earlier one
 *   ends just above it (the later entry's first line is its title, which the model is more
 *   sure of than where the earlier entry ends), noted;
 * - two entries starting on the same line: the later one in the model's list is dropped.
 */
export function resolveRanges(
  ranges: LineRange[],
  s: SectionLines,
  now: Date = new Date(),
): ResolvedRange[] {
  const n = s.lines.length;
  const label = (r: LineRange) =>
    Number.isInteger(r.from) && Number.isInteger(r.to)
      ? rangeLabel(s, r.from, r.to)
      : `${s.prefix}${r.from}–${s.prefix}${r.to}`;
  const out: ResolvedRange[] = new Array(ranges.length);
  const notes: string[][] = ranges.map(() => []);
  const valid: { i: number; from: number; to: number }[] = [];
  ranges.forEach((r, i) => {
    const whole = (why: string) => {
      out[i] = {
        ok: true,
        block: wholeSection(s),
        from: null,
        notes: [`${label(r)} ${why}; checked against the whole section`],
      };
    };
    if (!Number.isInteger(r.from) || !Number.isInteger(r.to))
      return whole("isn't whole line numbers");
    if (r.from < 1 || r.from > n) return whole("starts outside the section");
    if (r.to < r.from) return whole("ends before it starts");
    let to = r.to;
    if (to > n) {
      notes[i]!.push(`${label(r)} ends past the section; cut at line ${n}`);
      to = n;
    }
    valid.push({ i, from: r.from, to });
  });
  valid.sort((a, b) => a.from - b.from || a.i - b.i);
  const kept: typeof valid = [];
  for (const v of valid) {
    const prev = kept.at(-1);
    if (prev && v.from === prev.from) {
      out[v.i] = {
        ok: false,
        reason: `starts on the same line as another entry (${s.prefix}${v.from})`,
      };
      continue;
    }
    if (prev && prev.to >= v.from) {
      notes[prev.i]!.push(
        `${rangeLabel(s, prev.from, prev.to)} overlaps the next entry; ends at line ${v.from - 1}`,
      );
      prev.to = v.from - 1;
    }
    kept.push(v);
  }
  for (const v of kept)
    out[v.i] = {
      ok: true,
      block: blockFor(s, v.from, v.to, now),
      from: v.from,
      notes: notes[v.i]!,
    };
  return out;
}

/** A plain year: not part of a word, a number, a version, a price or a count ("2000+ users"). */
const PLAIN_YEAR =
  /(?<![\p{L}\p{N}_.\-$€£₹#])(\d{4})(?![\p{L}\p{N}+%]|[.\-/]\d)/gu;

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
