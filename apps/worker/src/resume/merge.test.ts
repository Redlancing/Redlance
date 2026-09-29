import { SKILLS, SKILL_BY_ID, suggestionsSchema } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { mergeResumeSteps } from "./merge";
import { splitSections } from "./sections";

const text =
  "Jane Doe\nSkills\nPython, Figma\nExperience\nBuilt dashboards with React and Node for Acme tooling.";
const sections = splitSections(text);

const ctx = (over: Partial<Parameters<typeof mergeResumeSteps>[1]> = {}) => ({
  text,
  sections,
  shortlist: ["python", "figma", "react"],
  yearsExperience: null as number | null,
  githubUsername: null as string | null,
  pipelineVersion: "p1",
  promptVersions: { basics: "b1", jobTypes: "j1", skills: "s1" },
  partial: [] as ("basics" | "jobTypes" | "skills")[],
  ...over,
});
const sk = (
  id: string,
  level: "core" | "secondary" = "core",
  evidence = "",
) => ({ id, level, evidence });
const skillsOut = (
  skills: ReturnType<typeof sk>[],
  customSkills: {
    name: string;
    level: "core" | "secondary";
    evidence: string;
  }[] = [],
) => ({ skills, customSkills });

describe("mergeResumeSteps", () => {
  it("drops unknown ids and fake evidence outside the shortlist", () => {
    const r = mergeResumeSteps(
      {
        skills: skillsOut([
          sk("nope", "core", "Built dashboards"),
          sk("rust", "core", "invented quote here"),
        ]),
      },
      ctx(),
    );
    expect(r.skills).toEqual([]);
  });
  it("keeps evidenced skills", () => {
    const r = mergeResumeSteps(
      { skills: skillsOut([sk("react", "core", "dashboards with React")]) },
      ctx(),
    );
    expect(r.skills).toEqual([{ id: "react", level: "core" }]);
  });
  it("drops evidence that is real text but does not mention the skill", () => {
    const r = mergeResumeSteps(
      { skills: skillsOut([sk("rust", "core", "Built dashboards with")]) },
      ctx(),
    );
    expect(r.skills).toEqual([]);
  });
  it("keeps a shortlisted skill listed in the skills section without evidence", () => {
    const r = mergeResumeSteps({ skills: skillsOut([sk("python")]) }, ctx());
    expect(r.skills.map((s) => s.id)).toEqual(["python"]);
  });
  it("maps custom 'reactjs' to react", () => {
    const r = mergeResumeSteps(
      {
        skills: skillsOut(
          [],
          [{ name: "reactjs", level: "core", evidence: "with React and Node" }],
        ),
      },
      ctx(),
    );
    expect(r.skills.map((s) => s.id)).toEqual(["react"]);
    expect(r.customSkills).toEqual([]);
  });
  it("keeps a real custom skill with evidence, drops one without", () => {
    const r = mergeResumeSteps(
      {
        skills: skillsOut(
          [],
          [
            {
              name: "Acme tooling",
              level: "secondary",
              evidence: "for Acme tooling",
            },
            { name: "Zzz", level: "secondary", evidence: "not in text at all" },
          ],
        ),
      },
      ctx(),
    );
    expect(r.customSkills).toEqual([
      { name: "Acme tooling", level: "secondary" },
    ]);
  });
  it("caps core at 8", () => {
    const ids = SKILLS.filter((x) => x.category === "development")
      .slice(0, 12)
      .map((x) => x.id);
    const t = "Skills\n" + ids.map((i) => SKILL_BY_ID.get(i)!.name).join(", ");
    const r = mergeResumeSteps(
      { skills: skillsOut(ids.map((i) => sk(i))) },
      ctx({ text: t, sections: splitSections(t), shortlist: ids }),
    );
    expect(r.skills.filter((s) => s.level === "core")).toHaveLength(8);
    expect(r.skills).toHaveLength(12);
  });
  it("years override the model's experience level", () => {
    const r = mergeResumeSteps(
      { jobTypes: { categories: [], experienceLevel: "experienced" } },
      ctx({ yearsExperience: 0.5 }),
    );
    expect(r.basics.experienceLevel).toBe("beginner");
    expect(
      mergeResumeSteps({}, ctx({ yearsExperience: 2 })).basics.experienceLevel,
    ).toBe("intermediate");
    expect(
      mergeResumeSteps({}, ctx({ yearsExperience: 3.5 })).basics
        .experienceLevel,
    ).toBe("experienced");
  });
  it("uses the model's level without years, and category evidence", () => {
    const r = mergeResumeSteps(
      {
        jobTypes: {
          categories: [
            { id: "development", evidence: "dashboards with React" },
            { id: "design", evidence: "made up" },
          ],
          experienceLevel: "intermediate",
        },
      },
      ctx(),
    );
    expect(r.basics.categories).toEqual(["development"]);
    expect(r.basics.experienceLevel).toBe("intermediate");
  });
  it("cleans basics", () => {
    const r = mergeResumeSteps(
      { basics: { displayName: " Jane ", headline: null, country: "ZZ" } },
      ctx(),
    );
    expect(r.basics).toEqual({ displayName: "Jane" });
    expect(
      mergeResumeSteps(
        { basics: { displayName: null, headline: "Dev", country: "IN" } },
        ctx(),
      ).basics,
    ).toEqual({ headline: "Dev", country: "IN" });
  });
  it("keeps partial meta with no skills step and passes the schema", () => {
    const r = mergeResumeSteps(
      {},
      ctx({ partial: ["skills"], githubUsername: "octocat" }),
    );
    expect(r.skills).toEqual([]);
    expect(r.meta?.partial).toEqual(["skills"]);
    expect(r.githubUsername).toBe("octocat");
    expect(suggestionsSchema.safeParse(r).success).toBe(true);
  });

  it("drops a display name that carries a link, an address or only digits", () => {
    const name = (displayName: string) =>
      mergeResumeSteps(
        { basics: { displayName, headline: null, country: null } },
        ctx(),
      ).basics.displayName;
    expect(name("Jane Doe")).toBe("Jane Doe");
    expect(name("https://evil.example")).toBeUndefined();
    expect(name("www.janedoe.com")).toBeUndefined();
    expect(name("janedoe.com")).toBeUndefined();
    expect(name("jane@example.com")).toBeUndefined();
    expect(name("+1 (555) 123-4567")).toBeUndefined();
  });

  it("strips links from the headline and drops it when nothing is left", () => {
    const headline = (h: string) =>
      mergeResumeSteps(
        { basics: { displayName: null, headline: h, country: null } },
        ctx(),
      ).basics.headline;
    expect(headline("Full-stack developer | https://jane.dev/work")).toBe(
      "Full-stack developer",
    );
    expect(headline("Designer www.dribbble.com/jane")).toBe("Designer");
    expect(headline("Writer, see x.com/jane")).toBe("Writer, see");
    expect(headline("https://jane.dev")).toBeUndefined();
    expect(headline(" www.a.com | x.com/b ")).toBeUndefined();
    expect(headline("Node.js/React developer")).toBe("Node.js/React developer");
    expect(headline("ASP.NET/C# engineer")).toBe("ASP.NET/C# engineer");
  });
});
