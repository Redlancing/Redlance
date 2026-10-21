import { describe, expect, it } from "vitest";
import {
  buildEvidence,
  draftRedFlags,
  payTypeRedFlags,
  type EvidenceInput,
  type EvidenceProjectInput,
  type EvidenceRoleInput,
} from "./evidence";

const now = new Date("2026-10-17T12:00:00Z");

const project = (
  id: string,
  o: Partial<EvidenceProjectInput> = {},
): EvidenceProjectInput => ({
  id,
  position: 0,
  title: `Project ${id}`,
  summary: `Summary of ${id}`,
  skillIds: [],
  categories: [],
  domains: [],
  outcomes: [],
  links: [],
  year: null,
  hidden: false,
  ...o,
});

const role = (
  id: string,
  o: Partial<EvidenceRoleInput> = {},
): EvidenceRoleInput => ({
  id,
  position: 0,
  title: `Role ${id}`,
  summary: `Summary of ${id}`,
  organisation: null,
  organisationDescription: "a small agency",
  skillIds: [],
  categories: [],
  domains: [],
  highlights: [],
  startYear: null,
  startMonth: null,
  endYear: null,
  endMonth: null,
  isCurrent: false,
  hidden: false,
  ...o,
});

const base: EvidenceInput = {
  now,
  post: { title: "Need a Next.js dev", summary: "Checkout page with payments" },
  analysis: {
    payType: "paid",
    categories: ["development"],
    skillIds: ["nextjs", "react", "payments", "postgresql", "typescript"],
    budgetMin: null,
    budgetMax: null,
    currency: null,
    budgetUnit: null,
    deadline: null,
    redFlags: [],
  },
  match: { broad: false, features: [], bestProjectId: null, bestRoleId: null },
  profile: {
    skills: [
      { id: "nextjs", level: "core" },
      { id: "react", level: "core" },
      { id: "payments", level: "core" },
      { id: "postgresql", level: "secondary" },
    ],
    githubUsername: null,
    mentionEmployers: false,
    minRateMinor: 3000,
    currency: "USD",
    rateType: "either",
  },
  projects: [],
  roles: [],
};
const mk = (o: Partial<EvidenceInput>): EvidenceInput => ({ ...base, ...o });
const withAnalysis = (o: Partial<EvidenceInput["analysis"]>) =>
  mk({ analysis: { ...base.analysis, ...o } });

describe("buildEvidence: choosing", () => {
  it("1: picks the project sharing two core skills", () => {
    const e = buildEvidence(
      mk({
        projects: [
          project("a", { skillIds: ["postgresql"] }),
          project("b", { skillIds: ["nextjs", "payments"] }),
          project("c", { skillIds: ["rust"] }),
        ],
      }),
    );
    expect(e.project?.id).toBe("b");
  });
  it("2: ties go to the most recent year", () => {
    const e = buildEvidence(
      mk({
        projects: [
          project("old", { skillIds: ["nextjs"], year: 2023 }),
          project("new", { skillIds: ["nextjs"], year: 2025, position: 1 }),
        ],
      }),
    );
    expect(e.project?.id).toBe("new");
  });
  it("3: a hidden best project is never chosen or shown", () => {
    const e = buildEvidence(
      mk({
        projects: [
          project("h", {
            hidden: true,
            title: "Secret Rocket",
            skillIds: ["nextjs", "payments", "react"],
          }),
          project("v", { skillIds: ["nextjs"] }),
        ],
      }),
    );
    expect(e.project?.id).toBe("v");
    expect(e.evidenceText).not.toContain("Secret Rocket");
    expect(JSON.stringify(e)).not.toContain("Secret Rocket");
  });
  it("4: the match's visible best project wins over the ranking", () => {
    const e = buildEvidence(
      mk({
        match: { ...base.match, bestProjectId: "weak" },
        projects: [
          project("strong", { skillIds: ["nextjs", "payments"] }),
          project("weak", { skillIds: ["rust"] }),
        ],
      }),
    );
    expect(e.project?.id).toBe("weak");
  });
  it("5: a best project that is hidden is ignored", () => {
    const e = buildEvidence(
      mk({
        match: { ...base.match, bestProjectId: "h" },
        projects: [
          project("h", { hidden: true, skillIds: ["rust"] }),
          project("strong", { skillIds: ["nextjs"] }),
        ],
      }),
    );
    expect(e.project?.id).toBe("strong");
  });
  it("6: exclude.projectIds skips the top project", () => {
    const e = buildEvidence(
      mk({
        projects: [
          project("top", { skillIds: ["nextjs", "payments"] }),
          project("second", { skillIds: ["nextjs"], position: 1 }),
        ],
        exclude: { projectIds: ["top"] },
      }),
    );
    expect(e.project?.id).toBe("second");
    expect(e.citedProjectIds).toEqual(["top", "second"]);
  });
  it("7: no projects: project null, role still chosen", () => {
    const e = buildEvidence(
      mk({ roles: [role("r", { skillIds: ["nextjs"] })] }),
    );
    expect(e.project).toBeNull();
    expect(e.role?.id).toBe("r");
    expect(e.citedProjectIds).toEqual([]);
  });
  it("shared categories and domains rank after skills", () => {
    const byCategory = buildEvidence(
      mk({
        projects: [
          project("none", {}),
          project("cat", { categories: ["development"], position: 1 }),
        ],
      }),
    );
    expect(byCategory.project?.id).toBe("cat");
    const byDomain = buildEvidence(
      mk({
        post: { title: "Shopify store help", summary: "ecommerce checkout" },
        projects: [
          project("none", {}),
          project("dom", { domains: ["e-commerce"], position: 1 }),
        ],
      }),
    );
    expect(byDomain.project?.id).toBe("dom");
  });
  it("a project with no overlap at all is not cited", () => {
    const e = buildEvidence(
      mk({ projects: [project("x", { skillIds: ["rust"] })] }),
    );
    expect(e.project).toBeNull();
  });
  it("ranks roles; a current role wins a tie, then the later end date", () => {
    const e = buildEvidence(
      mk({
        roles: [
          role("past", { skillIds: ["nextjs"], endYear: 2024 }),
          role("current", {
            skillIds: ["nextjs"],
            isCurrent: true,
            position: 1,
          }),
        ],
      }),
    );
    expect(e.role?.id).toBe("current");
    const f = buildEvidence(
      mk({
        roles: [
          role("early", { skillIds: ["nextjs"], endYear: 2021 }),
          role("late", { skillIds: ["nextjs"], endYear: 2024, position: 1 }),
        ],
      }),
    );
    expect(f.role?.id).toBe("late");
  });
  it("the match's best role is used when visible", () => {
    const e = buildEvidence(
      mk({
        match: { ...base.match, bestRoleId: "weak" },
        roles: [
          role("strong", { skillIds: ["nextjs"] }),
          role("weak", { skillIds: [] }),
        ],
      }),
    );
    expect(e.role?.id).toBe("weak");
  });
});

describe("buildEvidence: skills, link, rate, availability", () => {
  it("8: five matched skills out of order give the top 3 in the post's order", () => {
    const e = buildEvidence(
      mk({
        match: {
          ...base.match,
          features: [
            {
              signal: "core_skill",
              points: 60,
              detail: ["payments", "nextjs"],
            },
            {
              signal: "secondary_skill",
              points: 16,
              detail: ["typescript", "postgresql"],
            },
            { signal: "work_overlap", points: 10, detail: ["nextjs", "react"] },
            { signal: "job_type", points: 15, detail: ["development"] },
          ],
        },
      }),
    );
    expect(e.skills).toEqual(["Next.js", "React", "Payments integration"]);
    expect(e.summary.skills).toEqual(e.skills);
  });
  it("9: allowedLinks is the project's first link", () => {
    const e = buildEvidence(
      mk({
        profile: { ...base.profile, githubUsername: "priya" },
        projects: [
          project("p", {
            skillIds: ["nextjs"],
            links: ["https://bakery.example.com", "https://x.example.com"],
          }),
        ],
      }),
    );
    expect(e.allowedLinks).toEqual(["https://bakery.example.com"]);
    expect(e.project?.link).toBe("https://bakery.example.com");
  });
  it("10: without a project link, the GitHub URL", () => {
    const e = buildEvidence(
      mk({
        profile: { ...base.profile, githubUsername: "priya" },
        projects: [project("p", { skillIds: ["nextjs"] })],
      }),
    );
    expect(e.allowedLinks).toEqual(["https://github.com/priya"]);
  });
  it("11: no link at all", () => {
    expect(buildEvidence(base).allowedLinks).toEqual([]);
  });
  it("12: a budget that fits the minimum rate may be mentioned", () => {
    const e = buildEvidence(
      withAnalysis({
        budgetMax: 50,
        currency: "USD",
        budgetUnit: "hour",
      }),
    );
    expect(e.rateNote.mention).toBe(true);
    expect(e.rateNote.mention && e.rateNote.text).toBe(
      "the posted budget fits your rate",
    );
  });
  it("13: a budget below the minimum, or none, is not mentioned", () => {
    const below = buildEvidence(
      withAnalysis({ budgetMax: 10, currency: "USD", budgetUnit: "hour" }),
    );
    expect(below.rateNote).toEqual({ mention: false });
    expect(buildEvidence(base).rateNote).toEqual({ mention: false });
  });
  it("14: a deadline in 3 days gives availability; in 20 days does not", () => {
    expect(
      buildEvidence(withAnalysis({ deadline: "2026-10-20" })).availability,
    ).toBe("can start this week");
    expect(
      buildEvidence(withAnalysis({ deadline: "2026-11-06" })).availability,
    ).toBeNull();
    expect(
      buildEvidence(withAnalysis({ deadline: "2026-10-01" })).availability,
    ).toBeNull();
  });
});

describe("buildEvidence: red flags and privacy", () => {
  it("15: red flags and unpaid pay type go to the user, not the prompt text", () => {
    const e = buildEvidence(
      withAnalysis({
        redFlags: ["asks for free samples"],
        payType: "unpaid",
        budgetMax: 400,
        currency: "USD",
        budgetUnit: "fixed",
      }),
    );
    expect(e.redFlags).toEqual(["asks for free samples", "unpaid"]);
    expect(e.evidenceText).not.toContain("free samples");
    expect(e.evidenceText).not.toContain("unpaid");
  });
  const acmeRole = () =>
    role("acme", {
      title: "Frontend developer",
      summary: "Built the Acme Realty listing pages",
      organisation: "Acme Realty",
      organisationDescription: "a real estate agency",
      skillIds: ["nextjs"],
      highlights: ["Shipped search at Acme Realty", "Cut load time 40%"],
      startYear: 2021,
      endYear: 2023,
    });
  it("16: employers off: the name appears nowhere in the evidence", () => {
    const e = buildEvidence(
      mk({
        roles: [acmeRole()],
        projects: [
          project("p", {
            skillIds: ["nextjs"],
            summary: "Rebuilt the Acme Realty site",
            outcomes: ["Acme Realty doubled leads"],
          }),
        ],
      }),
    );
    const { organisationNames, ...rest } = e;
    expect(JSON.stringify(rest)).not.toContain("Acme Realty");
    expect(e.evidenceText).not.toContain("Acme Realty");
    expect(e.role?.organisation).toBeNull();
    expect(e.role?.organisationDescription).toBe("a real estate agency");
    expect(organisationNames).toContain("Acme Realty");
    expect(e.employerNamesAllowed).toBe(false);
  });
  it("17: employers on: the organisation is included", () => {
    const e = buildEvidence(
      mk({
        profile: { ...base.profile, mentionEmployers: true },
        roles: [acmeRole()],
      }),
    );
    expect(e.employerNamesAllowed).toBe(true);
    expect(e.role?.organisation).toBe("Acme Realty");
    expect(e.evidenceText).toContain("Acme Realty");
    expect(e.organisationNames).toContain("Acme Realty");
  });
  it("18: a freelance role (no organisation) does not crash", () => {
    for (const mentionEmployers of [false, true]) {
      const e = buildEvidence(
        mk({
          profile: { ...base.profile, mentionEmployers },
          roles: [role("f", { skillIds: ["nextjs"] })],
        }),
      );
      expect(e.role?.organisation).toBeNull();
      expect(e.organisationNames).toEqual([]);
    }
  });
  it("19: a broad match has broad true and no skills", () => {
    const e = buildEvidence(
      mk({
        match: {
          ...base.match,
          broad: true,
          features: [
            { signal: "job_type", points: 15, detail: ["development"] },
          ],
        },
        analysis: { ...base.analysis, skillIds: [] },
      }),
    );
    expect(e.broad).toBe(true);
    expect(e.skills).toEqual([]);
  });
  it("evidenceText carries project, role, skills, budget and deadline", () => {
    const e = buildEvidence(
      mk({
        analysis: {
          ...base.analysis,
          budgetMin: 300,
          budgetMax: 500,
          currency: "USD",
          budgetUnit: "fixed",
          deadline: "2026-10-20",
        },
        projects: [
          project("p", {
            title: "Bakery site",
            summary: "Online ordering",
            skillIds: ["nextjs"],
            outcomes: ["Orders up 30%"],
            year: 2025,
          }),
        ],
        roles: [
          role("r", {
            title: "Developer",
            skillIds: ["nextjs"],
            highlights: ["Led a team of 4"],
            startYear: 2021,
            endYear: 2023,
          }),
        ],
      }),
    );
    for (const s of [
      "Bakery site",
      "Online ordering",
      "Orders up 30%",
      "2025",
      "Developer",
      "Led a team of 4",
      "2021",
      "2023",
      "Next.js",
      "300",
      "500",
      "USD",
      "2026-10-20",
    ])
      expect(e.evidenceText).toContain(s);
    expect(e.summary).toEqual({
      projectTitle: "Bakery site",
      roleTitle: "Developer",
      skills: e.skills,
    });
  });
});

describe("buildEvidence: hidden-role employers and pay-type flags", () => {
  it("M1: an employer of a hidden role is scrubbed from a visible project and listed", () => {
    const e = buildEvidence(
      mk({
        projects: [
          project("p", {
            skillIds: ["nextjs"],
            summary: "Rebuilt Acme's checkout",
            outcomes: ["Acme sales up 20%"],
          }),
        ],
        roles: [],
        allOrganisations: [
          { organisation: "Acme", organisationDescription: "a retailer" },
        ],
      }),
    );
    const { organisationNames, ...rest } = e;
    expect(JSON.stringify(rest)).not.toMatch(/Acme/);
    expect(e.evidenceText).toContain("a retailer");
    expect(organisationNames).toContain("Acme");
    expect(e.role).toBeNull();
  });
  it("M1: a hidden role never becomes the role or shows in the evidence", () => {
    const e = buildEvidence(
      mk({
        roles: [
          role("h", {
            hidden: true,
            title: "Secret job",
            skillIds: ["nextjs"],
          }),
        ],
        allOrganisations: [
          { organisation: "Hidden Corp", organisationDescription: "a bank" },
        ],
      }),
    );
    expect(e.role).toBeNull();
    expect(e.evidenceText).not.toContain("Secret job");
    expect(e.organisationNames).toEqual(["Hidden Corp"]);
  });
  it("(b) commission-only and revshare pay types are red flags", () => {
    expect(
      buildEvidence(withAnalysis({ payType: "commission_only" })).redFlags,
    ).toEqual(["commission_only"]);
    const r = buildEvidence(
      withAnalysis({ payType: "revshare", redFlags: ["x"] }),
    );
    expect(r.redFlags).toEqual(["x", "revshare"]);
    expect(r.evidenceText).not.toContain("revshare");
    expect(payTypeRedFlags("paid")).toEqual([]);
    expect(payTypeRedFlags("unpaid")).toEqual(["unpaid"]);
    expect(
      draftRedFlags({
        payType: "commission_only",
        redFlags: ["commission_only", "y"],
      }),
    ).toEqual(["commission_only", "y"]);
    // "No budget stated" is a note, not a red flag.
    expect(
      draftRedFlags({ payType: "paid", redFlags: ["vague_pay", "y"] }),
    ).toEqual(["y"]);
  });
});
