import { describe, expect, it } from "vitest";
import { yearsOfExperience } from "./dates";

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
      yearsOfExperience("University of X 2015 - 2019\nAcme 2020 - 2021", NOW),
    ).toBe(2);
  });
});
