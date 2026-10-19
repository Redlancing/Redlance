import { WORK_LIMITS, type WorkDraft } from "@redlance/core";
import { describe, expect, it } from "vitest";
import {
  addProject,
  addRole,
  editEntry,
  fitKeys,
  formatDates,
  linkError,
  partialNotice,
  removeAt,
  setEmploymentType,
  setLine,
  toggleHidden,
} from "./work-cards";

type Role = WorkDraft["experience"][number];

describe("addProject", () => {
  it("appends an empty manual card", () => {
    const list = addProject([]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: "",
      summary: "",
      source: "manual",
      hidden: false,
      namesRemoved: false,
      skills: [],
      links: [],
    });
  });
  it("refuses past the limit", () => {
    let list = addProject([]);
    for (let i = 1; i < WORK_LIMITS.projects; i++) list = addProject(list);
    expect(list).toHaveLength(WORK_LIMITS.projects);
    expect(addProject(list)).toBe(list);
  });
});

describe("addRole", () => {
  it("appends an empty manual role", () => {
    const list = addRole([]);
    expect(list[0]).toMatchObject({
      title: "",
      organisation: null,
      start: null,
      end: null,
      current: false,
      source: "manual",
      hidden: false,
    });
  });
  it("refuses past the limit", () => {
    let list = addRole([]);
    for (let i = 1; i < WORK_LIMITS.roles; i++) list = addRole(list);
    expect(addRole(list)).toBe(list);
    expect(list).toHaveLength(WORK_LIMITS.roles);
  });
});

describe("removeAt", () => {
  it("removes only that card", () => {
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("setEmploymentType", () => {
  const role = { ...addRole([])[0]!, organisation: "Acme" } as Role;
  it("clears the organisation for freelance and contract", () => {
    expect(setEmploymentType(role, "freelance").organisation).toBeNull();
    expect(setEmploymentType(role, "contract").organisation).toBeNull();
  });
  it("keeps it for other types", () => {
    const next = setEmploymentType(role, "full_time");
    expect(next.organisation).toBe("Acme");
    expect(next.employmentType).toBe("full_time");
  });
});

describe("editEntry", () => {
  it("clears namesRemoved", () => {
    const card = { ...addProject([])[0]!, namesRemoved: true };
    const next = editEntry(card, { title: "New" });
    expect(next.title).toBe("New");
    expect(next.namesRemoved).toBe(false);
  });
});

describe("toggleHidden", () => {
  it("flips hidden and keeps namesRemoved", () => {
    const card = { ...addProject([])[0]!, namesRemoved: true };
    const once = toggleHidden(card);
    expect(once.hidden).toBe(true);
    expect(once.namesRemoved).toBe(true);
    expect(toggleHidden(once).hidden).toBe(false);
  });
});

describe("setLine", () => {
  it("replaces one line", () => {
    expect(setLine(["a", "b"], 1, "c")).toEqual(["a", "c"]);
  });
});

describe("formatDates", () => {
  it("shows month and year with Present", () => {
    expect(formatDates({ year: 2021, month: 1 }, null, true)).toBe(
      "Jan 2021 – Present",
    );
  });
  it("shows years only", () => {
    expect(
      formatDates(
        { year: 2019, month: null },
        { year: 2022, month: null },
        false,
      ),
    ).toBe("2019 – 2022");
  });
  it("shows a start only", () => {
    expect(formatDates({ year: 2023, month: null }, null, false)).toBe("2023");
  });
  it("is empty with no dates", () => {
    expect(formatDates(null, null, false)).toBe("");
  });
  it("shows only an end", () => {
    expect(formatDates(null, { year: 2020, month: 6 }, false)).toBe("Jun 2020");
  });
});

describe("linkError", () => {
  it("returns the message for a bad link", () => {
    expect(linkError("javascript:alert(1)")).toMatch(/https/);
  });
  it("returns null for a good one", () => {
    expect(linkError("site.io/work")).toBeNull();
  });
  it("is null while the box is empty", () => {
    expect(linkError("  ")).toBeNull();
  });
});

describe("fitKeys", () => {
  it("keeps, pads and trims", () => {
    expect(fitKeys(["a", "b"], 2, "p")).toEqual(["a", "b"]);
    expect(fitKeys(["a", "b"], 1, "p")).toEqual(["a"]);
    expect(fitKeys(["a"], 3, "p")).toEqual(["a", "p-pad-1", "p-pad-2"]);
  });
});

describe("partialNotice", () => {
  it("says a step failed when it ran and couldn't read the section", () => {
    expect(partialNotice(["projects"], [])).toBe(
      "We couldn't read your projects. Add them by hand.",
    );
    expect(partialNotice(["experience"], [])).toBe(
      "We couldn't read your experience. Add it by hand.",
    );
    expect(partialNotice(["projects", "experience"], [])).toBe(
      "We couldn't read your projects or experience. Add them by hand.",
    );
  });
  it("says the section wasn't found when the step was skipped", () => {
    expect(partialNotice([], ["projects"])).toBe(
      "We didn't find a Projects section in your resume, so add any projects by hand.",
    );
    expect(partialNotice([], ["experience"])).toBe(
      "We didn't find an Experience section in your resume, so add your experience by hand.",
    );
    expect(partialNotice([], ["projects", "experience"])).toBe(
      "We didn't find a Projects or Experience section in your resume, so add them by hand.",
    );
  });
  it("combines the two, ignores other steps, and is null for none", () => {
    expect(partialNotice(["projects"], ["experience"])).toBe(
      "We couldn't read your projects. Add them by hand. We didn't find an Experience section in your resume, so add your experience by hand.",
    );
    expect(partialNotice(["projects", "projects"], ["projects"])).toBe(
      "We couldn't read your projects. Add them by hand.",
    );
    expect(partialNotice(["skills"], ["basics"])).toBeNull();
    expect(partialNotice([], [])).toBeNull();
  });
});
