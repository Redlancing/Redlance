import {
  SKILLS,
  SKILL_BY_ID,
  suggestionsSchema,
  WORK_LIMITS,
  projectSuggestion,
  experienceSuggestion,
} from "@redlance/core";
import { describe, expect, it } from "vitest";
import { findRanges } from "./dates";
import {
  numberSection,
  rangeLabel,
  type Block,
  type EntryKind,
  type LineRange,
} from "./entries";
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
const skillsOut = (skills: ReturnType<typeof sk>[]) => ({ skills });

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
/**
 * The tests write each entry's section as test blocks ({ id: "P2", text }) and point an
 * entry at one with `block: "P2"`; `work()` joins the blocks into a section (a blank line
 * between them), gives each entry its block's line range (unless the test sets `lines`) and
 * maps the range labels in the drops back to the block ids. An unknown id gets lines 999–999.
 */
type TestBlock = Pick<Block, "id" | "text">;
type ProjectIn = Omit<ProjectOut, "lines"> & {
  block: string;
  lines?: LineRange;
};
type RoleIn = Omit<RoleOut, "lines"> & { block: string; lines?: LineRange };
type StepsIn = {
  projects?: { projects: ProjectIn[] };
  experience?: { experience: RoleIn[] };
};
const line = (text: string, clientNames: ClientName[] = []) => ({
  text,
  clientNames,
});
const proj = (over: Partial<ProjectIn> = {}): ProjectIn => ({
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
const role = (over: Partial<RoleIn> = {}): RoleIn => ({
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
  projectBlocks: [P1, P2] as TestBlock[],
  experienceBlocks: [E1, E2] as TestBlock[],
  shortlist: ["react", "nodejs", "wordpress", "seo", "react-native"],
  dropped: [] as DroppedItem[],
  replaced: [] as ReplacedName[],
});
type TestCtx = ReturnType<typeof workCtx>;

/** A section from test blocks, each block's line range, and range label → block id. */
function sectionOf(kind: EntryKind, blocks: TestBlock[]) {
  const section = numberSection(blocks.map((b) => b.text).join("\n\n"), kind);
  const ranges = new Map<string, LineRange>();
  const ids = new Map<string, string>();
  let n = 0;
  for (const b of blocks) {
    const count = b.text.split("\n").filter((l) => l.trim()).length;
    const r = { from: n + 1, to: n + count };
    ranges.set(b.id, r);
    if (section) ids.set(rangeLabel(section, r.from, r.to), b.id);
    n += count;
  }
  return { section, ranges, ids };
}

/** The real work context and steps for a test context and test steps. */
function realWork(steps: StepsIn, c: TestCtx) {
  const p = sectionOf("projects", c.projectBlocks);
  const e = sectionOf("experience", c.experienceBlocks);
  const at = (
    ranges: Map<string, LineRange>,
    it: { block: string; lines?: LineRange },
  ) => it.lines ?? ranges.get(it.block) ?? { from: 999, to: 999 };
  const real: Parameters<typeof mergeWork>[0] = {
    ...(steps.projects && {
      projects: {
        projects: steps.projects.projects.map(({ block: _b, ...it }) => ({
          ...it,
          lines: at(p.ranges, { block: _b, lines: it.lines }),
        })),
      },
    }),
    ...(steps.experience && {
      experience: {
        experience: steps.experience.experience.map(({ block: _b, ...it }) => ({
          ...it,
          lines: at(e.ranges, { block: _b, lines: it.lines }),
        })),
      },
    }),
  };
  const back = (label: string) => p.ids.get(label) ?? e.ids.get(label) ?? label;
  return {
    steps: real,
    projectLines: p.section,
    experienceLines: e.section,
    /** Copies drops and replaced names into the test context, labels mapped back to ids. */
    report(dropped: DroppedItem[], replaced: ReplacedName[]) {
      c.dropped.push(
        ...dropped.map((d) =>
          d.block === undefined ? d : { ...d, block: back(d.block) },
        ),
      );
      c.replaced.push(...replaced.map((r) => ({ ...r, block: back(r.block) })));
    },
  };
}

const work = (steps: StepsIn, c: TestCtx = workCtx()) => {
  const w = realWork(steps, c);
  const dropped: DroppedItem[] = [];
  const replaced: ReplacedName[] = [];
  const r = mergeWork(w.steps, {
    projectLines: w.projectLines,
    experienceLines: w.experienceLines,
    shortlist: c.shortlist,
    dropped,
    replaced,
  });
  w.report(dropped, replaced);
  return r;
};

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
          reason: "title not in its lines",
          block: "P1",
        },
        {
          what: "role",
          value: "CTO",
          reason: "title not in its lines",
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
        reason: "not word for word in its lines",
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
      reason: "not in its lines",
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
        reason: "label not in its lines",
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
      [
        "project",
        "project  1",
        "starts on the same line as another entry (P1)",
      ],
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

  it("checks an entry whose lines are outside the section against the whole section", () => {
    const c = workCtx();
    const r = work({ projects: { projects: [proj({ block: "P9" })] } }, c);
    expect(r.projects.map((p) => [p.title, p.year, p.links])).toEqual([
      ["Shopfront", null, []],
    ]);
    expect(c.dropped).toEqual([
      {
        what: "lines",
        value: "Shopfront",
        reason:
          "P999 starts outside the section; checked against the whole section",
        block: "projects",
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
    const w = realWork(
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
      c,
    );
    const replaced: ReplacedName[] = [];
    const r = mergeResumeSteps(
      w.steps,
      ctx({
        projectLines: w.projectLines,
        experienceLines: w.experienceLines,
        skipped: ["experience"],
        replaced,
      }),
    );
    w.report([], replaced);
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
  steps: StepsIn,
  blocks: { projects?: TestBlock[]; experience?: TestBlock[] },
) => {
  const c = {
    ...workCtx(),
    projectBlocks: blocks.projects ?? [],
    experienceBlocks: blocks.experience ?? [],
  };
  return { r: work(steps, c), c };
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

describe("mergeWork: entries checked against the lines the model picked", () => {
  /** One section, with the entries given as line ranges (no test blocks). */
  const ranged = (
    kind: EntryKind,
    text: string,
    items: { title: string; from: number; to: number; outcomes?: string[] }[],
  ) => {
    const c = {
      ...workCtx(),
      projectBlocks: kind === "projects" ? [{ id: "P", text }] : [],
      experienceBlocks: kind === "experience" ? [{ id: "E", text }] : [],
    };
    const steps: StepsIn =
      kind === "projects"
        ? {
            projects: {
              projects: items.map((it) =>
                proj({
                  title: it.title,
                  lines: { from: it.from, to: it.to },
                  outcomes: (it.outcomes ?? []).map((o) => line(o)),
                }),
              ),
            },
          }
        : {
            experience: {
              experience: items.map((it) =>
                role({
                  title: it.title,
                  organisation: "Acme Corp",
                  lines: { from: it.from, to: it.to },
                  highlights: (it.outcomes ?? []).map((o) => line(o)),
                }),
              ),
            },
          };
    return { r: work(steps, c), c };
  };

  it("splits a dash-bulleted list of three projects; an outcome claimed by the wrong project is dropped", () => {
    // Code splitting made this one block (fixture 02's layout).
    const text = [
      "- Recipe finder: a Next.js app that suggests meals, 2023",
      "  Cut search time by half for 300 users",
      "- Discord bot in Python for a gaming server, github.com/jane/bot",
      "  Handles 5,000 commands a day",
      "- Portfolio site in Astro, 2021",
    ].join("\n");
    const { r, c } = ranged("projects", text, [
      {
        title: "Recipe finder",
        from: 1,
        to: 2,
        outcomes: [
          "Cut search time by half for 300 users",
          "Handles 5,000 commands a day",
        ],
      },
      {
        title: "Discord bot",
        from: 3,
        to: 4,
        outcomes: ["Handles 5,000 commands a day"],
      },
      { title: "Portfolio site", from: 5, to: 5 },
    ]);
    expect(
      r.projects.map((p) => [p.title, p.year, p.links, p.outcomes]),
    ).toEqual([
      ["Recipe finder", 2023, [], ["Cut search time by half for 300 users"]],
      [
        "Discord bot",
        null,
        ["https://github.com/jane/bot"],
        ["Handles 5,000 commands a day"],
      ],
      ["Portfolio site", 2021, [], []],
    ]);
    expect(c.dropped).toEqual([
      {
        what: "outcome",
        value: "Handles 5,000 commands a day",
        reason: "not word for word in its lines",
        block: "P1–P2",
      },
    ]);
  });

  it("keeps every outcome of a project whose description code used to cut in two", () => {
    const text = [
      "Shopfront — Next.js storefront, 2023",
      "A headless store for a bakery.",
      "- Cut page load from 4 s to 1 s",
      "",
      "Payments",
      "- Added Stripe checkout for 2,000 orders a month",
      "",
      "TaskFlow (2022)",
      "- Offline sync for 300 users",
    ].join("\n");
    const { r } = ranged("projects", text, [
      {
        title: "Shopfront",
        from: 1,
        to: 5,
        outcomes: [
          "Cut page load from 4 s to 1 s",
          "Added Stripe checkout for 2,000 orders a month",
        ],
      },
      {
        title: "TaskFlow",
        from: 6,
        to: 7,
        outcomes: ["Offline sync for 300 users"],
      },
    ]);
    expect(r.projects.map((p) => [p.title, p.year, p.outcomes])).toEqual([
      [
        "Shopfront",
        2023,
        [
          "Cut page load from 4 s to 1 s",
          "Added Stripe checkout for 2,000 orders a month",
        ],
      ],
      ["TaskFlow", 2022, ["Offline sync for 300 users"]],
    ]);
  });

  it("gives each role only the dates on its own lines", () => {
    const text = [
      "Acme Corp",
      "Senior Developer, Jan 2021 – Present",
      "- Led the team",
      "Junior Developer",
      "- Fixed bugs",
      "Intern, Jun 2018 – Dec 2018",
      "- Wrote tests",
    ].join("\n");
    const { r } = ranged("experience", text, [
      { title: "Senior Developer", from: 1, to: 3, outcomes: ["Led the team"] },
      { title: "Junior Developer", from: 4, to: 5, outcomes: ["Led the team"] },
      { title: "Intern", from: 6, to: 7 },
    ]);
    expect(
      r.experience.map((e) => [
        e.title,
        e.start,
        e.end,
        e.current,
        e.highlights,
      ]),
    ).toEqual([
      [
        "Senior Developer",
        { year: 2021, month: 1 },
        null,
        true,
        ["Led the team"],
      ],
      ["Junior Developer", null, null, false, []],
      [
        "Intern",
        { year: 2018, month: 6 },
        { year: 2018, month: 12 },
        false,
        [],
      ],
    ]);
  });

  it("ends an overlapping entry above the next one, in line order, and notes it", () => {
    const text = ["Alpha app", "- Did alpha", "Beta app", "- Did beta"].join(
      "\n",
    );
    const { r, c } = ranged("projects", text, [
      { title: "Beta app", from: 3, to: 4, outcomes: ["Did beta"] },
      // Runs into Beta and claims its outcome.
      {
        title: "Alpha app",
        from: 1,
        to: 4,
        outcomes: ["Did alpha", "Did beta"],
      },
    ]);
    expect(r.projects.map((p) => [p.title, p.outcomes])).toEqual([
      ["Alpha app", ["Did alpha"]],
      ["Beta app", ["Did beta"]],
    ]);
    expect(c.dropped.map((d) => [d.what, d.reason, d.block])).toEqual([
      ["lines", "P1–P4 overlaps the next entry; ends at line 2", "P1–P2"],
      ["outcome", "not word for word in its lines", "P1–P2"],
    ]);
  });

  it("drops the later of two entries that start on the same line", () => {
    const text = ["Alpha app", "- Did alpha", "Beta app"].join("\n");
    const { r, c } = ranged("projects", text, [
      { title: "Alpha app", from: 1, to: 2 },
      { title: "Beta app", from: 1, to: 3 },
    ]);
    expect(r.projects.map((p) => p.title)).toEqual(["Alpha app"]);
    expect(c.dropped).toEqual([
      {
        what: "project",
        value: "Beta app",
        reason: "starts on the same line as another entry (P1)",
        block: "projects",
      },
    ]);
  });

  it("checks a reversed or outside range against the whole section, without dates, year or links", () => {
    const text = [
      "Alpha app, 2020, alpha.dev",
      "- Did alpha",
      "Beta app, 2022",
      "- Did beta",
    ].join("\n");
    const { r, c } = ranged("projects", text, [
      { title: "Beta app", from: 4, to: 3, outcomes: ["Did beta"] },
      { title: "Alpha app", from: 7, to: 9, outcomes: ["Did alpha"] },
    ]);
    // Resume order from where each title is; no year or links from someone else's lines.
    expect(
      r.projects.map((p) => [p.title, p.year, p.links, p.outcomes]),
    ).toEqual([
      ["Alpha app", null, [], ["Did alpha"]],
      ["Beta app", null, [], ["Did beta"]],
    ]);
    expect(c.dropped.map((d) => [d.what, d.value, d.reason, d.block])).toEqual([
      [
        "lines",
        "Beta app",
        "P4–P3 ends before it starts; checked against the whole section",
        "projects",
      ],
      [
        "lines",
        "Alpha app",
        "P7–P9 starts outside the section; checked against the whole section",
        "projects",
      ],
    ]);
  });

  it("cuts a range that runs past the section and keeps the entry", () => {
    const text = ["Alpha app", "- Did alpha"].join("\n");
    const { r, c } = ranged("projects", text, [
      { title: "Alpha app", from: 1, to: 30, outcomes: ["Did alpha"] },
    ]);
    expect(r.projects[0]!.outcomes).toEqual(["Did alpha"]);
    expect(c.dropped.map((d) => d.reason)).toEqual([
      "P1–P30 ends past the section; cut at line 2",
    ]);
  });

  it("drops entries for a section the resume doesn't have", () => {
    const c = { ...workCtx(), projectBlocks: [] };
    const r = work({ projects: { projects: [proj()] } }, c);
    expect(r.projects).toEqual([]);
    expect(c.dropped).toEqual([
      {
        what: "project",
        value: "Shopfront",
        reason: "its section isn't in the resume",
        block: "projects",
      },
    ]);
  });

  it("ignores our line marker copied into a title or an outcome", () => {
    const text = ["Alpha app", "- Did alpha well"].join("\n");
    const { r } = ranged("projects", text, [
      {
        title: "[P1] Alpha app",
        from: 1,
        to: 2,
        outcomes: ["[P2] Did alpha well"],
      },
    ]);
    expect(r.projects.map((p) => [p.title, p.outcomes])).toEqual([
      ["Alpha app", ["Did alpha well"]],
    ]);
  });

  it("still drops a role listed twice", () => {
    const text = [
      "Acme Corp, Jan 2019 – Present",
      "Developer",
      "- Led the team",
      "Tester",
      "- Tested",
    ].join("\n");
    const { r, c } = ranged("experience", text, [
      { title: "Developer", from: 1, to: 3 },
      { title: "Tester", from: 4, to: 5 },
      { title: "Tester", from: 4, to: 5 },
    ]);
    expect(r.experience.map((e) => e.title)).toEqual(["Developer", "Tester"]);
    expect(c.dropped).toContainEqual(
      expect.objectContaining({
        what: "role",
        reason: "starts on the same line as another entry (E4)",
      }),
    );
  });
});

describe("over-long values never fail a call (checked in full, then trimmed)", () => {
  const long = (n: number, w = "word") =>
    Array.from({ length: Math.ceil(n / (w.length + 1)) }, () => w)
      .join(" ")
      .slice(0, n)
      .trim();
  const longTitle = `Shopfront ${long(78)}`; // 88 chars
  const block = (id: string, text: string): Block => ({
    id,
    text,
    range: null,
    year: 2023,
    links: [],
  });

  it("keeps a project whose title (88 chars), summary, outcome and names are too long", () => {
    const outcome = `Cut page load ${long(150)} for Acme Realty.`;
    const P: Block = block("P1", `${longTitle}\n- ${outcome}`);
    const c = { ...workCtx(), projectBlocks: [P, P2] };
    const r = work(
      {
        projects: {
          projects: [
            proj({
              title: longTitle,
              summary: long(250),
              outcomes: [
                line(outcome, [
                  { name: "Acme Realty", generic: long(100, "agency") },
                ]),
              ],
            }),
            proj({ block: "P2", title: "TaskFlow" }),
          ],
        },
      },
      c,
    );
    expect(r.projects.map((p) => p.title)[1]).toBe("TaskFlow");
    const first = r.projects[0]!;
    expect(first.title.length).toBeLessThanOrEqual(WORK_LIMITS.entryTitle);
    expect(first.title.endsWith("…")).toBe(true);
    expect(longTitle.startsWith(first.title.slice(0, -2))).toBe(true);
    expect(first.summary.length).toBeLessThanOrEqual(WORK_LIMITS.entrySummary);
    expect(first.outcomes[0]!.length).toBeLessThanOrEqual(
      WORK_LIMITS.entrySummary,
    );
    expect(projectSuggestion.safeParse(first).success).toBe(true);
  });

  it("keeps a role whose title, organisation, description, summary and highlight are too long", () => {
    const org = `Finlytics ${long(80, "Labs")}`;
    const title = `Senior ${long(100, "Engineer")}`;
    const hl = `Led the team ${long(200)}.`;
    const E: Block = block(
      "E1",
      `${title}, ${org}\tJan 2021 – Present\n• ${hl}`,
    );
    const r = work(
      {
        experience: {
          experience: [
            role({
              title,
              organisation: org,
              organisationDescription: long(150, "payments"),
              summary: long(300),
              highlights: [line(hl)],
            }),
          ],
        },
      },
      { ...workCtx(), experienceBlocks: [E, E2] },
    );
    expect(r.experience).toHaveLength(1);
    const e = r.experience[0]!;
    expect(e.title.length).toBeLessThanOrEqual(WORK_LIMITS.entryTitle);
    expect((e.organisation ?? "").length).toBeLessThanOrEqual(
      WORK_LIMITS.organisation,
    );
    expect(e.organisationDescription.length).toBeLessThanOrEqual(
      WORK_LIMITS.orgDescription,
    );
    expect(e.summary.length).toBeLessThanOrEqual(WORK_LIMITS.entrySummary);
    expect(e.highlights[0]!.length).toBeLessThanOrEqual(
      WORK_LIMITS.entrySummary,
    );
    expect(experienceSuggestion.safeParse(e).success).toBe(true);
  });

  it("trims a 100-char displayName and a 200-char headline", () => {
    const r = mergeResumeSteps(
      {
        basics: {
          displayName: long(100, "Jane"),
          headline: long(200),
          country: null,
        },
      },
      ctx(),
    );
    expect(r.basics.displayName!.length).toBeLessThanOrEqual(60);
    expect(r.basics.headline!.length).toBeLessThanOrEqual(120);
    expect(suggestionsSchema.safeParse(r).success).toBe(true);
  });

  it("keeps a skill whose 250-char evidence quote is word for word in the resume", () => {
    const quote = `Built dashboards with React ${long(220)}`;
    const t = `Jane Doe\nSkills\nPython\nExperience\n${quote}`;
    const r = mergeResumeSteps(
      { skills: skillsOut([sk("react", "core", quote)]) },
      ctx({ text: t, sections: splitSections(t) }),
    );
    expect(r.skills).toEqual([{ id: "react", level: "core" }]);
  });
});
