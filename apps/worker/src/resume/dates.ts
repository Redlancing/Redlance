import type { MonthYear } from "@redlance/core";

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const TOKEN = String.raw`(?:(?:([A-Za-z]{3,9})\.?,?\s+|(\d{1,2})\s*\/\s*)?(\d{4}))`;
const RANGE = new RegExp(
  String.raw`(?<![\d/])${TOKEN}\s*(?:–|—|-|to)\s*(?:${TOKEN}|(present|current|now|today))(?![\d])`,
  "gi",
);

function monthIndex(name: string | undefined, num: string | undefined) {
  if (num) {
    const n = Number(num);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  if (name) {
    const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
    return i;
  }
  return null;
}

/** A line that describes a qualification, not a job ("Scrum Master", "360-degree" and employers don't count). */
const EDUCATION_LINE =
  /(?<![a-z])(b\.?\s?tech|b\.?\s?sc|[bm]\.[sea]\.?|bachelor['’]?s?|master['’]?s|master of|m\.?\s?sc|m\.?\s?tech|mba|ph\.?d|diploma|associate['’]?s? degree|degree in|graduated|student)(?![a-z])/i;

/** A real month name or abbreviation ("Sept", "June"), not a word that starts like one ("Nove", "Summer"). */
const MONTH_NAME =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;

/** 1–12, or null when the range gives no real month. */
function strictMonth(name: string | undefined, num: string | undefined) {
  if (num) {
    const n = Number(num);
    return n >= 1 && n <= 12 ? n : null;
  }
  if (name && MONTH_NAME.test(name))
    return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  return null;
}

export type DateRange = {
  start: MonthYear;
  /** null when the range ends in present, current, now or today. */
  end: MonthYear | null;
  current: boolean;
};

type Parsed = {
  range: DateRange;
  /** Months since year 0, as yearsOfExperience has always counted them. */
  from: number;
  to: number;
};

/**
 * Every date range in `text`, in order. Lines that describe a qualification
 * are skipped, and so are years before 1950 or after next year, reversed
 * ranges and ranges that start in the future.
 */
function parseRanges(text: string, now: Date): Parsed[] {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const minYear = 1950;
  const maxYear = now.getUTCFullYear() + 1;
  const okYear = (y: string) => Number(y) >= minYear && Number(y) <= maxYear;
  const usable = text
    .split("\n")
    .filter((l) => !EDUCATION_LINE.test(l))
    .join("\n");

  const out: Parsed[] = [];
  for (const m of usable.matchAll(RANGE)) {
    const [, sName, sNum, sYear, eName, eNum, eYear, word] = m;
    if (!okYear(sYear!) || (!word && !okYear(eYear!))) continue;
    // Any 3–9 letter word before a year counts as a month here ("Nove 2017" is
    // November), which keeps yearsOfExperience as it was. The range itself only
    // reports real month names.
    const sMonth = monthIndex(sName, sNum);
    const from =
      Number(sYear) * 12 + (sMonth !== null && sMonth >= 0 ? sMonth : 0);
    let to: number;
    if (word) to = nowIdx;
    else {
      const eMonth = monthIndex(eName, eNum);
      to = Number(eYear) * 12 + (eMonth !== null && eMonth >= 0 ? eMonth : 11);
    }
    if (to < from || from > nowIdx) continue;
    out.push({
      range: {
        start: { year: Number(sYear), month: strictMonth(sName, sNum) },
        end: word
          ? null
          : { year: Number(eYear), month: strictMonth(eName, eNum) },
        current: Boolean(word),
      },
      from,
      to: Math.min(to, nowIdx) + 1,
    });
  }
  return out;
}

/** Every date range in `text`, in order (see parseRanges for what is skipped). */
export function findRanges(text: string, now: Date = new Date()): DateRange[] {
  return parseRanges(text, now).map((p) => p.range);
}

/** Total months of work in the "Experience" text, from date ranges, rounded down to 0.5 years. */
export function yearsOfExperience(
  experience: string,
  now: Date = new Date(),
): number | null {
  const intervals: [number, number][] = parseRanges(experience, now).map(
    (p) => [p.from, p.to],
  );
  if (intervals.length === 0) return null;

  intervals.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let [curS, curE] = intervals[0]!;
  for (const [s, e] of intervals.slice(1)) {
    if (s <= curE) curE = Math.max(curE, e);
    else {
      months += curE - curS;
      [curS, curE] = [s, e];
    }
  }
  months += curE - curS;
  return Math.floor(months / 6) / 2;
}
