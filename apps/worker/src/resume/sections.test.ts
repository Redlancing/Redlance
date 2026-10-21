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

describe("more heading formats (resume@4)", () => {
  const sectionOf = (heading: string) => {
    const s = splitSections(`Jane Doe\n${heading}\nBody line`);
    return (Object.keys(s) as (keyof typeof s)[]).filter(
      (k) => k !== "top" && s[k] === "Body line",
    );
  };

  it("matches skills headings with other words around 'skills'", () => {
    for (const h of [
      "Technical Skills and Interests",
      "Skills & Tools",
      "SKILLS AND TOOLS:",
      "Key Skills",
      "Skills Summary",
      "Core Competencies",
      "Technologies",
      "Tech Stack",
      "Tools & Technologies",
      "Expertise",
      "Areas of Expertise",
      "Soft skills",
      "Languages & Skills",
    ])
      expect(sectionOf(h), h).toEqual(["skills"]);
  });

  it("routes headings we don't read to other, so they end the section above", () => {
    for (const h of [
      "Achievements",
      "Awards",
      "Honors and Awards",
      "Positions of Responsibility",
      "Leadership",
      "Leadership Experience",
      "Extracurricular Activities",
      "Extra-curricular",
      "Volunteer Experience",
      "Volunteering",
      "Publications",
      "Interests",
      "Hobbies",
      "References",
    ])
      expect(sectionOf(h), h).toEqual(["other"]);
  });

  it("routes coursework and licences to education", () => {
    for (const h of [
      "Relevant Coursework",
      "Coursework",
      "Licenses & Certifications",
      "Certifications",
    ])
      expect(sectionOf(h), h).toEqual(["education"]);
  });

  it("accepts letter-spaced headings, emoji icons and extra spaces", () => {
    expect(sectionOf("E X P E R I E N C E")).toEqual(["experience"]);
    expect(sectionOf("W O R K  E X P E R I E N C E")).toEqual(["experience"]);
    expect(sectionOf("📁 Projects")).toEqual(["projects"]);
    expect(sectionOf("🎓 EDUCATION:")).toEqual(["education"]);
    expect(sectionOf("  Technical   Skills  ")).toEqual(["skills"]);
  });

  it("never takes a bulleted or numbered line for a heading", () => {
    for (const h of [
      "– Tech Stack:",
      "• SKILLS:",
      "▪ Projects",
      "\uF0B7 Tools",
      "2. Education",
    ])
      expect(sectionOf(h), h).toEqual([]);
    const s = splitSections(
      "Projects\n• Shopfront (Next.js)\n– Tech Stack:\nReact, Stripe\nSkills\nGo",
    );
    expect(s.projects).toContain("– Tech Stack:");
    expect(s.skills).toBe("Go");
  });

  it("does not take short body lines that mention skills for headings", () => {
    const s = splitSections(
      "Experience\nDev, Acme 2020 - 2022\nTaught coding skills\nPeople skills matter a lot",
    );
    expect(s.skills).toBe("");
    expect(s.experience).toContain("Taught coding skills");
  });

  it("ends the projects section at the headings that follow it", () => {
    const s = splitSections(
      [
        "Jane Doe",
        "Education",
        "B.Tech, 2021 - 2025",
        "Projects",
        "Shopfront",
        "Chat app",
        "Technical Skills and Interests",
        "Languages: Python, C++",
        "Positions of Responsibility",
        "Club lead",
        "Achievements",
        "Hackathon winner",
      ].join("\n"),
    );
    expect(s.projects).toBe("Shopfront\nChat app");
    expect(s.skills).toBe("Languages: Python, C++");
    expect(s.other).toBe("Club lead\nHackathon winner");
    expect(s.experience).toBe("");
  });
});
