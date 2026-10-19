import { describe, expect, it } from "vitest";
import { findRanges, yearsOfExperience } from "./dates";

const NOW = new Date("2026-09-29T00:00:00Z");

describe("yearsOfExperience", () => {
  it("counts a month range", () => {
    expect(yearsOfExperience("Jan 2020 – Dec 2021", NOW)).toBe(2);
  });
  it("merges overlapping ranges", () => {
    expect(
      yearsOfExperience("Jan 2020 - Dec 2021\nJune 2021 to Dec 2022", NOW),
    ).toBe(3);
  });
  it("handles Present with year-only start", () => {
    expect(yearsOfExperience("2019 – Present", NOW)).toBe(7.5);
  });
  it("handles numeric months and now", () => {
    expect(yearsOfExperience("03/2020 – 06/2021", NOW)).toBe(1);
    expect(yearsOfExperience("2025 – now", NOW)).toBe(1.5);
  });
  it("returns null with no ranges", () => {
    expect(yearsOfExperience("nothing here", NOW)).toBeNull();
  });
  it("ignores future starts and reversed ranges", () => {
    expect(yearsOfExperience("2030 - 2031", NOW)).toBeNull();
    expect(yearsOfExperience("2022 - 2020", NOW)).toBeNull();
  });
  it("ignores phone numbers, office hours and education lines", () => {
    expect(yearsOfExperience("Call +65 1234-5678", NOW)).toBeNull();
    expect(yearsOfExperience("Hours 0900-1700", NOW)).toBeNull();
    expect(yearsOfExperience("B.Tech 2018 – 2022", NOW)).toBeNull();
    expect(
      yearsOfExperience(
        "B.Sc, University of X 2015 - 2019\nAcme 2020 - 2021",
        NOW,
      ),
    ).toBe(2);
  });
  it("does not mistake job titles or employers for education", () => {
    expect(yearsOfExperience("Scrum Master, Acme 2018 - 2022", NOW)).toBe(5);
    expect(
      yearsOfExperience(
        "Software Engineer, Stanford University 2019 - 2021",
        NOW,
      ),
    ).toBe(3);
    expect(yearsOfExperience("B.Tech, IIT 2018 - 2022", NOW)).toBeNull();
  });
  it("recognises more qualification spellings but not 360-degree", () => {
    for (const l of [
      "B. Tech 2018 - 2022",
      "B.S. 2018 - 2022",
      "M.E. 2018 - 2020",
      "Master’s 2018 - 2020",
      "Degree in CS 2015 - 2019",
    ])
      expect(yearsOfExperience(l, NOW)).toBeNull();
    expect(yearsOfExperience("360-degree video editor 2018 - 2020", NOW)).toBe(
      3,
    );
  });
});

describe("yearsOfExperience is unchanged (values pinned from the code before Slice 4)", () => {
  it.each([
    ["Studio Nove 2017 – 2019", 2],
    ["Sept. 2017 to May 2018", 0.5],
    ["Summer 2020 - 2021", 2],
    ["January 2020 – March 2020", 0],
    ["Jan 2021 – Present\nJun 2019 – Dec 2020", 7],
    ["Senior Dev 2018-2020, Lead 2020 - current", 8.5],
    ["Oct 2025 – Present", 1],
    ["2024 - 2027", 2.5],
    ["13/2020 - 06/2021", 1.5],
    ["Jan 2020 - Dec 2019", null],
    ["Dec 2026 - Present", null],
  ] as const)("%j → %s", (text, years) => {
    expect(yearsOfExperience(text, NOW)).toBe(years);
  });
});

describe("findRanges", () => {
  it("returns each range with months", () => {
    expect(
      findRanges("Senior Engineer, Finlytics\tJan 2021 – Present", NOW),
    ).toEqual([{ start: { year: 2021, month: 1 }, end: null, current: true }]);
    expect(findRanges("Motion Designer at Pixelhaus 2019-2022", NOW)).toEqual([
      {
        start: { year: 2019, month: null },
        end: { year: 2022, month: null },
        current: false,
      },
    ]);
  });

  it("reads many date formats", () => {
    const one = (t: string) => findRanges(t, NOW)[0];
    expect(one("Software Engineer | ShopKart | 06/2018 - 12/2020")).toEqual({
      start: { year: 2018, month: 6 },
      end: { year: 2020, month: 12 },
      current: false,
    });
    expect(one("Freelance Web Developer — Sept. 2017 to May 2018")).toEqual({
      start: { year: 2017, month: 9 },
      end: { year: 2018, month: 5 },
      current: false,
    });
    expect(one("March 2022 - now")).toEqual({
      start: { year: 2022, month: 3 },
      end: null,
      current: true,
    });
    expect(one("Feb, 2020 — Current")?.current).toBe(true);
    expect(one("Jan 2023–Today")?.start).toEqual({ year: 2023, month: 1 });
    expect(one("DECEMBER 2019 TO JUNE 2021")).toEqual({
      start: { year: 2019, month: 12 },
      end: { year: 2021, month: 6 },
      current: false,
    });
  });

  it("returns every range, in text order", () => {
    const r = findRanges(
      "Lead 2020 - current\nDev 06/2018 - 12/2019\nIntern 2017 – 2018",
      NOW,
    );
    expect(r.map((x) => x.start.year)).toEqual([2020, 2018, 2017]);
  });

  it("gives a null month for words that only look like months", () => {
    // yearsOfExperience still reads "Nove" as November (unchanged); findRanges doesn't.
    expect(
      findRanges("Junior Editor, Studio Nove 2017 – 2019", NOW)[0]?.start,
    ).toEqual({
      year: 2017,
      month: null,
    });
    expect(findRanges("Summer 2020 - 2021", NOW)[0]?.start.month).toBeNull();
    expect(findRanges("13/2020 - 06/2021", NOW)[0]?.start).toEqual({
      year: 2020,
      month: null,
    });
  });

  it("skips education lines", () => {
    expect(
      findRanges("B.Tech Computer Science, VIT Vellore 2014 – 2018", NOW),
    ).toEqual([]);
    expect(
      findRanges(
        "Diploma in Film Editing, 2016 - 2017\nEditor 2018 - 2020",
        NOW,
      ).map((r) => r.start.year),
    ).toEqual([2018]);
  });

  it("skips phone numbers, reversed ranges and future starts", () => {
    expect(findRanges("Call +65 1234-5678", NOW)).toEqual([]);
    expect(findRanges("Hours 0900-1700", NOW)).toEqual([]);
    expect(findRanges("Jan 2020 - Dec 2019", NOW)).toEqual([]);
    expect(findRanges("2030 - 2031", NOW)).toEqual([]);
    expect(findRanges("Dec 2026 - Present", NOW)).toEqual([]);
  });

  it("returns an empty list for text without dates", () => {
    expect(findRanges("", NOW)).toEqual([]);
    expect(findRanges("Built 3 apps in 2021", NOW)).toEqual([]);
  });
});
