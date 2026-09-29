import { describe, expect, it } from "vitest";
import { splitSections } from "./sections";

describe("splitSections", () => {
  it("splits a two-heading resume", () => {
    const s = splitSections(
      "Jane Doe\njane@x.com\nExperience\nAcme 2020 - 2022\nSkills\nReact, Node",
    );
    expect(s.top).toBe("Jane Doe\njane@x.com");
    expect(s.experience).toBe("Acme 2020 - 2022");
    expect(s.skills).toBe("React, Node");
    expect(s.summary).toBe("");
  });
  it("recognises 'Tech Stack:' and unknown headings append", () => {
    const s = splitSections("Name\nTech Stack:\nGo\nLanguages\nEnglish");
    expect(s.skills).toBe("Go\nLanguages\nEnglish");
  });
  it("puts everything everywhere when there are no headings", () => {
    const t = "just some text\nabout me maybe";
    const s = splitSections(t);
    for (const v of Object.values(s)) expect(v).toBe(t);
  });
  it("ignores long lines that start like headings", () => {
    const s = splitSections("Skills\nWork experience with lots of things in a long sentence here");
    expect(s.experience).toBe("");
    expect(s.skills).toContain("Work experience");
  });
});
