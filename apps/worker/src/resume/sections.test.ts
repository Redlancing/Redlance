import { describe, expect, it } from "vitest";
import { splitSections, splitSectionsWithFlag } from "./sections";

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
    const s = splitSections(
      "Skills\nWork experience with lots of things in a long sentence here",
    );
    expect(s.experience).toBe("");
    expect(s.skills).toContain("Work experience");
  });
});

describe("wider headings (Slice 4)", () => {
  const sectionOf = (heading: string) => {
    const s = splitSections(`Jane Doe\n${heading}\nBody line`);
    return (Object.keys(s) as (keyof typeof s)[]).filter(
      (k) => k !== "top" && s[k] === "Body line",
    );
  };

  it("matches the new project headings", () => {
    for (const h of [
      "Personal Projects",
      "SIDE PROJECTS:",
      "Open Source Contributions",
      "Open-source",
      "Case studies",
      "Hackathons",
      "Hackathon",
      "Key Projects",
      "ACADEMIC PROJECTS",
      "Capstone Project",
      "Client Work",
      "  Selected Work :  ",
      "Projects",
      "Portfolio",
    ])
      expect(sectionOf(h), h).toEqual(["projects"]);
  });

  it("matches the new experience headings", () => {
    for (const h of [
      "Relevant Experience",
      "Career History",
      "Internships",
      "Internship",
      "Freelance experience",
      "INDUSTRY EXPERIENCE",
      "Professional  Experience",
      "Work History:",
      "EMPLOYMENT HISTORY",
      "Experience",
    ])
      expect(sectionOf(h), h).toEqual(["experience"]);
  });

  it('"Freelance projects" is projects, "Freelance experience" is experience', () => {
    const s = splitSections(
      "FREELANCE PROJECTS\nShop site\nFreelance Experience\nDesigner 2020 - 2022",
    );
    expect(s.projects).toBe("Shop site");
    expect(s.experience).toBe("Designer 2020 - 2022");
  });

  it("does not treat sentences that mention projects as headings", () => {
    const s = splitSections(
      "Experience\nLed side projects for clients\nProjects I am proud of include many",
    );
    expect(s.projects).toBe("");
    expect(s.experience).toContain("Led side projects");
  });

  it("headed is true when a heading is found", () => {
    const r = splitSectionsWithFlag("Jane\nPERSONAL PROJECTS\nShopfront");
    expect(r.headed).toBe(true);
    expect(r.sections.projects).toBe("Shopfront");
  });

  it("headed is false when no heading is found and every section equals the whole text", () => {
    const t =
      "Marco Rossi\nVideo editor\nLead Editor, Brightframe 2022 - now\n• Cut 200 videos";
    const r = splitSectionsWithFlag(t);
    expect(r.headed).toBe(false);
    for (const v of Object.values(r.sections)) expect(v).toBe(t);
  });

  it("splitSections returns the same sections as splitSectionsWithFlag", () => {
    const t = "A\nSKILLS\nGo\nExperience\nDev 2020 - 2021";
    expect(splitSections(t)).toEqual(splitSectionsWithFlag(t).sections);
  });
});
