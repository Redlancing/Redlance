import { SKILLS, SKILL_BY_ID, suggestionsSchema } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { findRanges } from "./dates";
import { splitEntries, type Block } from "./entries";
import {
  fit,
  mergeResumeSteps,
  mergeWork,
  type DroppedItem,
  type ReplacedName,
} from "./merge";
import type { ClientName } from "./names";
import { splitSections } from "./sections";
import type { ExperienceOutput, ProjectsOutput } from "./step-types";

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

// ---------- projects and experience ----------

const P1: Block = {
  id: "P1",
  text: [
    "Shopfront for Acme Realty — Next.js site, 2023 · github.com/jane/shopfront",
    "- Cut page load from 4 s to 1 s for Acme Realty's 30 agents.",
    "- Built with React and Node.js; reviewed by the Acme Realty team.",
  ].join("\n"),
  range: null,
  year: 2023,
  links: ["https://github.com/jane/shopfront"],
};
const P2: Block = {
  id: "P2",
  text: "TaskFlow (2022)\n• React Native todo app with offline sync for 2,000 users.",
  range: null,
  year: 2022,
  links: [],
};
const E1: Block = {
  id: "E1",
  text: [
    "Senior Engineer, Finlytics\tJan 2021 – Present",
    "• Led the Finlytics payments team of 4 using React.",
    "• Cut API latency by 40% for Globex Bank's reports.",
  ].join("\n"),
  range: { start: { year: 2021, month: 1 }, end: null, current: true },
  year: null,
  links: [],
};
const E2: Block = {
  id: "E2",
  text: [
    "Freelance Web Developer, Bright Studio · Mar 2017 – May 2018",
    "- Built WordPress sites for Bright Studio clients.",
    "- Ran SEO audits for 12 local restaurants.",
  ].join("\n"),
  range: {
    start: { year: 2017, month: 3 },
    end: { year: 2018, month: 5 },
    current: false,
  },
  year: null,
  links: [],
};

type ProjectOut = ProjectsOutput["projects"][number];
type RoleOut = ExperienceOutput["experience"][number];
const line = (text: string, clientNames: ClientName[] = []) => ({
  text,
  clientNames,
});
const proj = (over: Partial<ProjectOut> = {}): ProjectOut => ({
  block: "P1",
  title: "Shopfront",
  summary: "A fast storefront for a property agency.",
  role: "solo",
  kind: "client",
  skills: [],
  categories: [],
  domains: [],
  outcomes: [],
  clientNames: [],
  ...over,
});
const role = (over: Partial<RoleOut> = {}): RoleOut => ({
  block: "E1",
  title: "Senior Engineer",
  organisation: "Finlytics",
  organisationDescription: "a fintech payments company",
  employmentType: "full_time",
  summary: "Built payment dashboards.",
  highlights: [],
  skills: [],
  categories: [],
  domains: [],
  clientNames: [],
  ...over,
});
const workCtx = () => ({
  projectBlocks: [P1, P2],
  experienceBlocks: [E1, E2],
  shortlist: ["react", "nodejs", "wordpress", "seo", "react-native"],
  dropped: [] as DroppedItem[],
  replaced: [] as ReplacedName[],
});
const work = (
  steps: Parameters<typeof mergeWork>[0],
  c: ReturnType<typeof workCtx> = workCtx(),
) => mergeWork(steps, c);

describe("mergeWork", () => {
  it("drops an entry whose title isn't in its block", () => {
    const c = workCtx();
    const r = work(
      {
        projects: { projects: [proj({ title: "Invented App" }), proj()] },
        experience: {
          experience: [
            role({ title: "CTO" }),
            role({
              block: "E2",
              title: "Freelance Web Developer",
              organisation: null,
            }),
          ],
        },
      },
      c,
    );
    expect(r.projects.map((p) => p.title)).toEqual(["Shopfront"]);
    expect(r.experience.map((e) => e.title)).toEqual([
      "Freelance Web Developer",
    ]);
    expect(c.dropped).toEqual(
      expect.arrayContaining([
        {
          what: "project",
          value: "Invented App",
          reason: "title not in its block",
          block: "P1",
        },
        {
          what: "role",
          value: "CTO",
          reason: "title not in its block",
          block: "E1",
        },
      ]),
    );
  });

  it("matches a title in its block ignoring case and spacing, but only in its own block", () => {
    const r = work({
      projects: {
        projects: [
          proj({ title: "  SHOPFRONT   for acme realty " }),
          proj({ block: "P2", title: "Shopfront" }),
        ],
      },
    });
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]!.title).toBe("SHOPFRONT for acme realty");
  });

  it("drops an outcome or highlight that isn't word for word in its block", () => {
    const c = workCtx();
    const r = work(
      {
        projects: {
          projects: [
            proj({
              outcomes: [
                line("Cut page load from 4 s to 1 s"),
                line("Tripled sales in a month"),
                // Real, but from another block.
                line("React Native todo app with offline sync"),
              ],
            }),
          ],
        },
        experience: {
          experience: [
            role({
              highlights: [
                line("Led the Finlytics payments team of 4 using React."),
                line("Managed a team of 40"),
              ],
            }),
          ],
        },
      },
      c,
    );
    expect(r.projects[0]!.outcomes).toEqual(["Cut page load from 4 s to 1 s"]);
    expect(r.experience[0]!.highlights).toHaveLength(1);
    expect(
      c.dropped.filter((d) => d.what === "outcome").map((d) => d.value),
    ).toEqual([
      "Tripled sales in a month",
      "React Native todo app with offline sync",
    ]);
    expect(c.dropped.filter((d) => d.what === "highlight")).toEqual([
      {
        what: "highlight",
        value: "Managed a team of 40",
        reason: "not word for word in its block",
        block: "E1",
      },
    ]);
  });

  it("runs the verbatim check on the original line, before replacing names", () => {
    const r = work({
      projects: {
        projects: [
          proj({
            outcomes: [
              line(
                "Cut page load from 4 s to 1 s for Acme Realty's 30 agents.",
                [{ name: "Acme Realty", generic: "a real-estate agency" }],
              ),
            ],
          }),
        ],
      },
    });
    expect(r.projects[0]!.outcomes).toEqual([
      "Cut page load from 4 s to 1 s for a real-estate agency's 30 agents.",
    ]);
  });

  it("replaces client names in highlights and sets namesRemoved", () => {
    const c = workCtx();
    const r = work(
      {
        experience: {
          experience: [
            role({
              highlights: [
                line("Cut API latency by 40% for Globex Bank's reports.", [
                  { name: "Globex Bank", generic: "a retail bank" },
                ]),
              ],
            }),
          ],
        },
      },
      c,
    );
    expect(r.experience[0]!.highlights).toEqual([
      "Cut API latency by 40% for a retail bank's reports.",
    ]);
    expect(r.experience[0]!.namesRemoved).toBe(true);
    expect(c.replaced).toEqual([
      {
        block: "E1",
        name: "Globex Bank",
        generic: "a retail bank",
        source: "model",
      },
    ]);
  });

  it("ignores a client name that isn't in the block", () => {
    const c = workCtx();
    const r = work(
      {
        projects: {
          projects: [
            proj({
              outcomes: [
                line("Cut page load from 4 s to 1 s", [
                  { name: "Initech", generic: "a client" },
                ]),
              ],
            }),
          ],
        },
      },
      c,
    );
    expect(r.projects[0]!.outcomes).toEqual(["Cut page load from 4 s to 1 s"]);
    expect(r.projects[0]!.namesRemoved).toBe(false);
    expect(c.replaced).toEqual([]);
  });

  it("applies an entry's names to its title, summary and every line", () => {
    const r = work({
      projects: {
        projects: [
          proj({
            title: "Shopfront for Acme Realty",
            summary: "A Next.js storefront for Acme Realty agents.",
            outcomes: [
              line(
                "Cut page load from 4 s to 1 s for Acme Realty's 30 agents.",
                [{ name: "Acme Realty", generic: "a real-estate agency" }],
              ),
              // The model didn't list the name on this line; the entry's names still apply.
              line("reviewed by the Acme Realty team"),
            ],
          }),
        ],
      },
    });
    const p = r.projects[0]!;
    expect(p.title).toBe("Shopfront for a real-estate agency");
    expect(p.summary).toBe(
      "A Next.js storefront for a real-estate agency agents.",
    );
    expect(p.outcomes).toEqual([
      "Cut page load from 4 s to 1 s for a real-estate agency's 30 agents.",
      "reviewed by the a real-estate agency team",
    ]);
    expect(p.namesRemoved).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/acme/i);
  });

  it("scrubs a freelance role's organisation from its title, highlights and summary, then drops it", () => {
    const c = workCtx();
    const r = work(
      {
        experience: {
          experience: [
            role({
              block: "E2",
              title: "Freelance Web Developer",
              organisation: "Bright Studio",
              organisationDescription: "a design studio",
              employmentType: "freelance",
              summary: "Built sites for Bright Studio.",
              highlights: [
                line("Built WordPress sites for Bright Studio clients."),
              ],
            }),
          ],
        },
      },
      c,
    );
    const e = r.experience[0]!;
    expect(e.organisation).toBeNull();
    expect(e.organisationDescription).toBe("a design studio");
    expect(e.highlights).toEqual([
      "Built WordPress sites for a design studio clients.",
    ]);
    expect(e.summary).toBe("Built sites for a design studio.");
    expect(e.namesRemoved).toBe(true);
    expect(c.replaced).toEqual([
      {
        block: "E2",
        name: "Bright Studio",
        generic: "a design studio",
        source: "organisation",
      },
    ]);
    expect(JSON.stringify(r)).not.toContain("Bright");
  });

  it('does the same for a contract role, with "a client" when there is no description', () => {
    const r = work({
      experience: {
        experience: [
          role({
            block: "E2",
            title: "Freelance Web Developer, Bright Studio",
            organisation: "Bright Studio",
            organisationDescription: "",
            employmentType: "contract",
            highlights: [
              line("Built WordPress sites for Bright Studio clients."),
            ],
          }),
        ],
      },
    });
    const e = r.experience[0]!;
    expect(e.organisation).toBeNull();
    expect(e.title).toBe("Freelance Web Developer, a client");
    expect(e.highlights).toEqual([
      "Built WordPress sites for a client clients.",
    ]);
    expect(e.namesRemoved).toBe(true);
  });

  it("replaces the employer name in a full-time role's highlights but keeps organisation", () => {
    const c = workCtx();
    const r = work(
      {
        experience: {
          experience: [
            role({
              highlights: [
                line("Led the Finlytics payments team of 4 using React."),
              ],
            }),
          ],
        },
      },
      c,
    );
    expect(c.replaced).toEqual([
      {
        block: "E1",
        name: "Finlytics",
        generic: "a fintech payments company",
        source: "organisation",
      },
    ]);
    const e = r.experience[0]!;
    expect(e.organisation).toBe("Finlytics");
    expect(e.title).toBe("Senior Engineer");
    expect(e.highlights).toEqual([
      "Led the a fintech payments company payments team of 4 using React.",
    ]);
    expect(e.namesRemoved).toBe(true);
  });

  it("sets organisation to null when it isn't in the block", () => {
    const c = workCtx();
    const r = work(
      {
        experience: {
          experience: [
            role({
              organisation: "Finly",
              highlights: [
                line("Led the Finlytics payments team of 4 using React."),
              ],
            }),
          ],
        },
      },
      c,
    );
    expect(r.experience[0]!.organisation).toBeNull();
    expect(r.experience[0]!.highlights).toEqual([
      "Led the Finlytics payments team of 4 using React.",
    ]);
    expect(r.experience[0]!.namesRemoved).toBe(false);
    expect(c.dropped).toContainEqual({
      what: "organisation",
      value: "Finly",
      reason: "not in its block",
      block: "E1",
    });
  });

  it("fixes an organisationDescription that contains the organisation", () => {
    const desc = (employmentType: RoleOut["employmentType"], block = "E1") =>
      work({
        experience: {
          experience: [
            role({
              block,
              title:
                block === "E1" ? "Senior Engineer" : "Freelance Web Developer",
              organisation: block === "E1" ? "Finlytics" : "Bright Studio",
              organisationDescription:
                block === "E1"
                  ? "Finlytics, a fintech"
                  : "the bright studio agency",
              employmentType,
            }),
          ],
        },
      }).experience[0]!.organisationDescription;
    expect(desc("full_time")).toBe("a company");
    expect(desc("freelance", "E2")).toBe("a client");
  });

  it("keeps only shortlisted skills whose label is in the block", () => {
    const c = workCtx();
    const r = work(
      {
        projects: {
          projects: [
            proj({ skills: ["react", "nodejs", "wordpress", "react", "rust"] }),
          ],
        },
      },
      c,
    );
    expect(r.projects[0]!.skills).toEqual(["react", "nodejs"]);
    expect(c.dropped.filter((d) => d.what === "skill")).toEqual([
      {
        what: "skill",
        value: "wordpress",
        reason: "label not in its block",
        block: "P1",
      },
      {
        what: "skill",
        value: "rust",
        reason: "not on the shortlist",
        block: "P1",
      },
    ]);
  });

  it("strips links from summaries and drops summaries with an email or phone number", () => {
    const c = workCtx();
    const summary = (s: string) =>
      work({ projects: { projects: [proj({ summary: s })] } }, c).projects[0]!
        .summary;
    expect(summary("A storefront, live at https://shopfront.vercel.app")).toBe(
      "A storefront, live at",
    );
    expect(summary("Storefront (github.com/jane/shopfront)")).toBe(
      "Storefront (",
    );
    expect(summary("Contact jane@example.com for a demo")).toBe("");
    expect(summary("Call +44 7700 900123 for a demo")).toBe("");
    expect(summary("Ran from 2019 - 2023 for 2,000 users")).toBe(
      "Ran from 2019 - 2023 for 2,000 users",
    );
    expect(
      c.dropped.filter((d) => d.what === "summary").map((d) => d.reason),
    ).toEqual(["contact details", "contact details"]);
  });

  it("attaches dates, year and links from the block", () => {
    const r = work({
      projects: {
        projects: [
          proj(),
          proj({ block: "P2", title: "TaskFlow", kind: "personal" }),
        ],
      },
      experience: {
        experience: [
          role(),
          role({
            block: "E2",
            title: "Freelance Web Developer",
            organisation: null,
            employmentType: "freelance",
          }),
        ],
      },
    });
    expect(r.projects.map((p) => [p.year, p.links])).toEqual([
      [2023, ["https://github.com/jane/shopfront"]],
      [2022, []],
    ]);
    expect(r.experience.map((e) => [e.start, e.end, e.current])).toEqual([
      [{ year: 2021, month: 1 }, null, true],
      [{ year: 2017, month: 3 }, { year: 2018, month: 5 }, false],
    ]);
  });

  it("keeps resume order, removes duplicate titles, caps at 8 projects and 6 roles", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      id: `P${i + 1}`,
      text: `Project ${i + 1}\n- Did a thing number ${i + 1}`,
      range: null,
      year: null,
      links: [],
    }));
    const roles = Array.from({ length: 8 }, (_, i) => ({
      id: `E${i + 1}`,
      text: `Engineer ${i + 1}, Co${i + 1}\n- Did work ${i + 1}`,
      range: null,
      year: null,
      links: [],
    }));
    const c = { ...workCtx(), projectBlocks: blocks, experienceBlocks: roles };
    const projects = blocks
      .map((b, i) => proj({ block: b.id, title: `Project ${i + 1}` }))
      .reverse();
    projects.push(proj({ block: "P1", title: "project  1" }));
    const r = work(
      {
        projects: { projects },
        experience: {
          experience: roles.map((b, i) =>
            role({
              block: b.id,
              title: `Engineer ${i + 1}`,
              organisation: `Co${i + 1}`,
            }),
          ),
        },
      },
      c,
    );
    expect(r.projects.map((p) => p.title)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Project ${i + 1}`),
    );
    expect(r.experience.map((e) => e.title)).toEqual(
      Array.from({ length: 6 }, (_, i) => `Engineer ${i + 1}`),
    );
    expect(c.dropped.map((d) => [d.what, d.value, d.reason])).toEqual([
      ["project", "project  1", "duplicate title"],
      ["project", "Project 9", "over the limit of 8"],
      ["project", "Project 10", "over the limit of 8"],
      ["role", "Engineer 7", "over the limit of 6"],
      ["role", "Engineer 8", "over the limit of 6"],
    ]);
  });

  it("keeps two roles with the same title at different organisations", () => {
    const c = {
      ...workCtx(),
      experienceBlocks: [
        { ...E1, id: "E1", text: "Engineer, Finlytics 2021 – 2022" },
        { ...E1, id: "E2", text: "Engineer, Globex 2019 – 2021" },
      ],
    };
    const r = work(
      {
        experience: {
          experience: [
            role({ title: "Engineer", organisation: "Finlytics" }),
            role({ block: "E2", title: "Engineer", organisation: "Globex" }),
          ],
        },
      },
      c,
    );
    expect(r.experience.map((e) => e.organisation)).toEqual([
      "Finlytics",
      "Globex",
    ]);
  });

  it("drops an entry that points at an unknown block", () => {
    const c = workCtx();
    const r = work({ projects: { projects: [proj({ block: "P9" })] } }, c);
    expect(r.projects).toEqual([]);
    expect(c.dropped).toEqual([
      {
        what: "project",
        value: "Shopfront",
        reason: "unknown block",
        block: "P9",
      },
    ]);
  });

  it("shortens a line that a longer phrase pushed over the limit", () => {
    const long = `${"x".repeat(150)} for IBM`;
    const r = work(
      {
        projects: {
          projects: [
            proj({
              block: "P3",
              title: "Big",
              outcomes: [
                line(long, [
                  { name: "IBM", generic: "a large technology firm" },
                ]),
              ],
            }),
          ],
        },
      },
      {
        ...workCtx(),
        projectBlocks: [{ ...P2, id: "P3", text: `Big\n- ${long}` }],
      },
    );
    const out = r.projects[0]!.outcomes[0]!;
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out).not.toContain("IBM");
  });
});

describe("mergeResumeSteps with projects and experience", () => {
  it("writes projects, experience and meta.skipped, and passes the schema", () => {
    const c = workCtx();
    const r = mergeResumeSteps(
      {
        projects: {
          projects: [
            proj({
              outcomes: [
                line(
                  "Cut page load from 4 s to 1 s for Acme Realty's 30 agents.",
                  [{ name: "Acme Realty", generic: "a real-estate agency" }],
                ),
              ],
              skills: ["react"],
              categories: ["development"],
              domains: ["real-estate"],
            }),
          ],
        },
      },
      ctx({
        projectBlocks: c.projectBlocks,
        experienceBlocks: c.experienceBlocks,
        skipped: ["experience"],
        replaced: c.replaced,
      }),
    );
    expect(suggestionsSchema.safeParse(r).success).toBe(true);
    expect(r.meta?.skipped).toEqual(["experience"]);
    expect(r.experience).toEqual([]);
    expect(r.projects).toEqual([
      {
        title: "Shopfront",
        summary: "A fast storefront for a property agency.",
        role: "solo",
        kind: "client",
        skills: ["react"],
        categories: ["development"],
        domains: ["real-estate"],
        outcomes: [
          "Cut page load from 4 s to 1 s for a real-estate agency's 30 agents.",
        ],
        links: ["https://github.com/jane/shopfront"],
        year: 2023,
        namesRemoved: true,
      },
    ]);
    expect(c.replaced).toHaveLength(1);
  });

  it("defaults to no projects or experience without those steps", () => {
    const r = mergeResumeSteps({}, ctx());
    expect(r.projects).toEqual([]);
    expect(r.experience).toEqual([]);
    expect(r.meta?.skipped).toEqual([]);
  });
});

// ---------- review fixes: names anywhere in an entry ----------

const ACME = { name: "Acme Realty", generic: "a real-estate agency" };
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const block = (id: string, text: string, over: Partial<Block> = {}): Block => ({
  id,
  text,
  range: findRanges(text, new Date("2026-10-01T00:00:00Z"))[0] ?? null,
  year: null,
  links: [],
  ...over,
});
const only = (
  steps: Parameters<typeof mergeWork>[0],
  blocks: { projects?: Block[]; experience?: Block[] },
) => {
  const c = {
    ...workCtx(),
    projectBlocks: blocks.projects ?? [],
    experienceBlocks: blocks.experience ?? [],
  };
  return { r: mergeWork(steps, c), c };
};

describe("mergeWork: entry-level client names", () => {
  it("scrubs a project title named only at entry level, with a name-free outcome", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              title: "Shopfront for Acme Realty",
              outcomes: [line("Cut page load from 4 s to 1 s")],
              clientNames: [ACME],
            }),
          ],
        },
      },
      {
        projects: [
          block(
            "P1",
            "Shopfront for Acme Realty — Next.js site\n- Cut page load from 4 s to 1 s",
          ),
        ],
      },
    );
    expect(r.projects[0]!.title).toBe("Shopfront for a real-estate agency");
    expect(r.projects[0]!.namesRemoved).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/acme/i);
  });

  it("scrubs a summary named at entry level", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              summary: "Storefront built for Acme Realty agents.",
              clientNames: [ACME],
            }),
          ],
        },
      },
      { projects: [block("P1", "Shopfront\n- for Acme Realty")] },
    );
    expect(r.projects[0]!.summary).toBe(
      "Storefront built for a real-estate agency agents.",
    );
  });

  it("scrubs a freelance title when the model gives no organisation", () => {
    const { r } = only(
      {
        experience: {
          experience: [
            role({
              title: "Freelance developer for Acme Realty",
              organisation: null,
              organisationDescription: "a real-estate agency",
              employmentType: "freelance",
              summary: "Built Acme Realty's listings site.",
              clientNames: [ACME],
            }),
          ],
        },
      },
      {
        experience: [
          block(
            "E1",
            "Freelance developer for Acme Realty, Jan 2020 – Present",
          ),
        ],
      },
    );
    const e = r.experience[0]!;
    expect(e.title).toBe("Freelance developer for a real-estate agency");
    expect(e.summary).toBe("Built a real-estate agency's listings site.");
    expect(e.namesRemoved).toBe(true);
  });

  it("ignores an entry-level name that isn't in the block", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({ clientNames: [{ name: "Initech", generic: "a bank" }] }),
          ],
        },
      },
      { projects: [block("P1", "Shopfront\n- Fast")] },
    );
    expect(r.projects[0]!.namesRemoved).toBe(false);
  });

  it("applies line-level names to every field, and every name to every line", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              title: "Shopfront for Acme Realty",
              summary: "Listings for Globex agents.",
              outcomes: [
                line("Built search for Globex", [
                  { name: "Globex", generic: "a property portal" },
                ]),
                line("Cut load times for Acme Realty"),
              ],
              clientNames: [ACME],
            }),
          ],
        },
      },
      {
        projects: [
          block(
            "P1",
            "Shopfront for Acme Realty\n- Built search for Globex\n- Cut load times for Acme Realty",
          ),
        ],
      },
    );
    expect(JSON.stringify(r)).not.toMatch(/acme|globex/i);
  });
});

describe("mergeWork: organisation descriptions and phrases that share a word", () => {
  it('refuses a phrase sharing a word with the name ("Acme\'s agency")', () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              title: "Shopfront for Acme Realty",
              clientNames: [{ name: "Acme Realty", generic: "Acme's agency" }],
            }),
          ],
        },
      },
      { projects: [block("P1", "Shopfront for Acme Realty")] },
    );
    expect(r.projects[0]!.title).toBe("Shopfront for a client");
  });

  it("refuses a freelance description that shares a word with the organisation", () => {
    const { r, c } = only(
      {
        experience: {
          experience: [
            role({
              title: "Freelance web developer",
              organisation: "Acme Realty",
              organisationDescription: "Acme's real-estate brokerage",
              employmentType: "freelance",
              highlights: [line("Built the listings site for Acme Realty")],
            }),
          ],
        },
      },
      {
        experience: [
          block(
            "E1",
            "Freelance web developer — Acme Realty, Jan 2020 – Present\n- Built the listings site for Acme Realty",
          ),
        ],
      },
    );
    const e = r.experience[0]!;
    expect(e.organisationDescription).toBe("a client");
    expect(e.highlights).toEqual(["Built the listings site for a client"]);
    expect(JSON.stringify(r)).not.toMatch(/acme/i);
    expect(c.dropped).toContainEqual(
      expect.objectContaining({ what: "organisationDescription" }),
    );
  });

  it('uses "a company" for a full-time description that shares a word', () => {
    const { r } = only(
      {
        experience: {
          experience: [
            role({
              title: "Engineer",
              organisation: "Globex Corporation",
              organisationDescription: "Globex's logistics arm",
              highlights: [line("Shipped Globex Corporation tracking")],
            }),
          ],
        },
      },
      {
        experience: [
          block(
            "E1",
            "Engineer — Globex Corporation, Jan 2020 – Present\n- Shipped Globex Corporation tracking",
          ),
        ],
      },
    );
    const e = r.experience[0]!;
    expect(e.organisationDescription).toBe("a company");
    expect(e.highlights).toEqual(["Shipped a company tracking"]);
    expect(e.organisation).toBe("Globex Corporation");
  });

  it("refuses a description that shares a word with a listed client name", () => {
    const { r } = only(
      {
        experience: {
          experience: [
            role({
              organisationDescription: "Globex's fintech arm",
              highlights: [
                line("Cut API latency by 40% for Globex Bank's reports.", [
                  { name: "Globex Bank", generic: "a retail bank" },
                ]),
              ],
            }),
          ],
        },
      },
      { experience: [E1] },
    );
    expect(r.experience[0]!.organisationDescription).toBe("a company");
  });
});

describe("mergeWork: an organisation the block writes differently", () => {
  const E = block(
    "E1",
    "Web developer — Acme Realty, Jan 2020 – Present\n- Built the listings site for Acme Realty",
  );
  const acmeRole = (over: Partial<RoleOut>) =>
    role({
      title: "Web developer",
      organisation: "Acme Realty Inc.",
      organisationDescription: "a real-estate agency",
      highlights: [line("Built the listings site for Acme Realty")],
      ...over,
    });

  it("finds it without the legal suffix and scrubs a freelance role", () => {
    const { r, c } = only(
      {
        experience: {
          experience: [acmeRole({ employmentType: "freelance" })],
        },
      },
      { experience: [E] },
    );
    const e = r.experience[0]!;
    expect(e.organisation).toBeNull();
    expect(e.highlights).toEqual([
      "Built the listings site for a real-estate agency",
    ]);
    expect(e.namesRemoved).toBe(true);
    expect(c.dropped.filter((d) => d.what === "organisation")).toEqual([]);
    expect(c.replaced).toEqual([
      {
        block: "E1",
        name: "Acme Realty",
        generic: "a real-estate agency",
        source: "organisation",
      },
    ]);
  });

  it("stores the name as the block writes it for a full-time role", () => {
    const { r } = only(
      {
        experience: { experience: [acmeRole({ employmentType: "full_time" })] },
      },
      { experience: [E] },
    );
    expect(r.experience[0]!.organisation).toBe("Acme Realty");
    expect(r.experience[0]!.highlights).toEqual([
      "Built the listings site for a real-estate agency",
    ]);
  });

  it("flags a freelance role whose organisation still isn't found", () => {
    const { r } = only(
      {
        experience: {
          experience: [
            acmeRole({
              employmentType: "contract",
              organisation: "Initech",
              highlights: [],
            }),
          ],
        },
      },
      { experience: [E] },
    );
    expect(r.experience[0]!.organisation).toBeNull();
    expect(r.experience[0]!.namesRemoved).toBe(true);
  });
});

describe("mergeWork: links that name a client", () => {
  it("drops links and bare domains that hold a replaced name", () => {
    const P = block(
      "P1",
      [
        "Shopfront for Acme Realty — acmerealty.com/listings · https://github.com/jane/shop",
        "- Launched acmerealty.com",
        "- Launched acmerealty.com in 6 weeks with Next.js",
      ].join("\n"),
      {
        links: [
          "https://acmerealty.com/listings",
          "https://github.com/jane/shop",
        ],
      },
    );
    const { r, c } = only(
      {
        projects: {
          projects: [
            proj({
              title: "Shopfront for Acme Realty",
              outcomes: [
                line("Launched acmerealty.com"),
                line("Launched acmerealty.com in 6 weeks with Next.js"),
              ],
              clientNames: [ACME],
            }),
          ],
        },
      },
      { projects: [P] },
    );
    const p = r.projects[0]!;
    expect(p.links).toEqual(["https://github.com/jane/shop"]);
    expect(p.outcomes).toEqual(["Launched in 6 weeks with Next.js"]);
    expect(p.namesRemoved).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/acme/i);
    expect(c.dropped).toContainEqual(
      expect.objectContaining({
        what: "outcome",
        value: "Launched acmerealty.com",
      }),
    );
  });
});

describe("mergeWork: a line cut in the middle of a name", () => {
  it("cuts the partial name off the end of the line", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              outcomes: [
                line("Cut page load for Acme Rea", [
                  { name: "Acme Realty", generic: "a realtor" },
                ]),
              ],
            }),
          ],
        },
      },
      {
        projects: [
          block("P1", "Shopfront\n- Cut page load for Acme Realty agents"),
        ],
      },
    );
    expect(r.projects[0]!.outcomes).toEqual(["Cut page load"]);
  });

  it("drops the line when little is left", () => {
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              outcomes: [line("Shipped for Acme Rea", [ACME])],
            }),
          ],
        },
      },
      {
        projects: [block("P1", "Shopfront\n- Shipped for Acme Realty agents")],
      },
    );
    expect(r.projects[0]!.outcomes).toEqual([]);
  });
});

describe("fit", () => {
  it("never leaves a lone surrogate", () => {
    for (let n = 70; n < 82; n++) {
      const out = fit(`${"a".repeat(n)}😀😀😀😀😀`, 80);
      expect(out.length).toBeLessThanOrEqual(80);
      expect(out).not.toMatch(LONE_SURROGATE);
      expect(() => JSON.stringify(out)).not.toThrow();
    }
    expect(fit("short 😀", 80)).toBe("short 😀");
  });

  it("keeps merged lines valid when an emoji sits at the cut", () => {
    const long = `${"x".repeat(158)}😀 for IBM`;
    const { r } = only(
      {
        projects: {
          projects: [
            proj({
              title: "Big",
              outcomes: [
                line(long, [
                  { name: "IBM", generic: "a large technology firm" },
                ]),
              ],
            }),
          ],
        },
      },
      { projects: [block("P1", `Big\n- ${long}`)] },
    );
    const out = r.projects[0]!.outcomes[0]!;
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out).not.toMatch(LONE_SURROGATE);
  });
});

describe("mergeWork: full-time employer names", () => {
  it("replaces the employer in the title and summary but keeps organisation", () => {
    const { r } = only(
      {
        experience: {
          experience: [
            role({
              title: "Senior Engineer, Finlytics",
              summary: "Led payments at Finlytics.",
            }),
          ],
        },
      },
      { experience: [E1] },
    );
    const e = r.experience[0]!;
    expect(e.title).toBe("Senior Engineer, a fintech payments company");
    expect(e.summary).toBe("Led payments at a fintech payments company.");
    expect(e.organisation).toBe("Finlytics");
    expect(e.namesRemoved).toBe(true);
  });

  it('uses "a company" when the description is empty', () => {
    const { r } = only(
      {
        experience: {
          experience: [
            role({
              title: "Senior Engineer, Finlytics",
              organisationDescription: "",
            }),
          ],
        },
      },
      { experience: [E1] },
    );
    expect(r.experience[0]!.title).toBe("Senior Engineer, a company");
  });
});

describe("mergeWork: several entries in one block", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("gives each project only the links and year on its own lines", () => {
    // DOCX drops list bullets, so one-line projects end up in a single block.
    const blocks = splitEntries(
      [
        "Meal Planner | React | 2023 | mealplanner.web.app/demo",
        "Budget Buddy | Vue | budgetbuddy.app/try",
        "Weather Now | Svelte | 2021 | github.com/jane/weather",
      ].join("\n"),
      "projects",
      { headed: true, now },
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.links).toHaveLength(3);
    const { r } = only(
      {
        projects: {
          projects: ["Meal Planner", "Budget Buddy", "Weather Now"].map(
            (title) => proj({ title }),
          ),
        },
      },
      { projects: blocks },
    );
    expect(r.projects.map((p) => [p.title, p.year, p.links])).toEqual([
      ["Meal Planner", 2023, ["https://mealplanner.web.app/demo"]],
      ["Budget Buddy", null, ["https://budgetbuddy.app/try"]],
      ["Weather Now", 2021, ["https://github.com/jane/weather"]],
    ]);
  });

  it("keeps a single entry's block links and year as before", () => {
    const { r } = only(
      { projects: { projects: [proj()] } },
      { projects: [P1] },
    );
    expect(r.projects[0]!.year).toBe(2023);
    expect(r.projects[0]!.links).toEqual(["https://github.com/jane/shopfront"]);
  });

  it("still drops a role listed twice from the same block", () => {
    const E = block(
      "E1",
      "Acme Corp, Jan 2019 – Present\nDeveloper\n- Led the team\nTester\n- Tested",
    );
    const { r, c } = only(
      {
        experience: {
          experience: ["Developer", "Tester", "Tester"].map((title) =>
            role({ title, organisation: "Acme Corp" }),
          ),
        },
      },
      { experience: [E] },
    );
    expect(r.experience.map((e) => e.title)).toEqual(["Developer", "Tester"]);
    expect(c.dropped).toContainEqual(
      expect.objectContaining({ what: "role", reason: "duplicate title" }),
    );
  });

  it("gives block dates only to the first role, unless a role has its own", () => {
    const E = block(
      "E1",
      [
        "Acme Corp, Jan 2019 – Present",
        "Senior Developer",
        "- Led the team",
        "Junior Developer",
        "- Fixed bugs",
        "Intern, Jun 2018 – Dec 2018",
        "- Wrote tests",
      ].join("\n"),
    );
    const { r } = only(
      {
        experience: {
          experience: ["Senior Developer", "Junior Developer", "Intern"].map(
            (title) => role({ title, organisation: "Acme Corp" }),
          ),
        },
      },
      { experience: [E] },
    );
    expect(
      r.experience.map((e) => [e.title, e.start, e.end, e.current]),
    ).toEqual([
      ["Senior Developer", { year: 2019, month: 1 }, null, true],
      ["Junior Developer", null, null, false],
      ["Intern", { year: 2018, month: 6 }, { year: 2018, month: 12 }, false],
    ]);
  });
});
