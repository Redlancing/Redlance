const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
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

/** Total months of work in the "Experience" text, from date ranges, rounded down to 0.5 years. */
export function yearsOfExperience(
  experience: string,
  now: Date = new Date(),
): number | null {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const intervals: [number, number][] = [];
  let any = false;

  const minYear = 1950;
  const maxYear = now.getUTCFullYear() + 1;
  const okYear = (y: string) => Number(y) >= minYear && Number(y) <= maxYear;
  const usable = experience
    .split("\n")
    .filter((l) => !EDUCATION_LINE.test(l))
    .join("\n");

  for (const m of usable.matchAll(RANGE)) {
    const [, sName, sNum, sYear, eName, eNum, eYear, word] = m;
    if (!okYear(sYear!) || (!word && !okYear(eYear!))) continue;
    const sMonth = monthIndex(sName, sNum);
    const start = Number(sYear) * 12 + (sMonth !== null && sMonth >= 0 ? sMonth : 0);
    let end: number;
    if (word) end = nowIdx;
    else {
      const eMonth = monthIndex(eName, eNum);
      end = Number(eYear) * 12 + (eMonth !== null && eMonth >= 0 ? eMonth : 11);
    }
    if (end < start || start > nowIdx) continue;
    intervals.push([start, Math.min(end, nowIdx) + 1]);
    any = true;
  }
  if (!any) return null;

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
