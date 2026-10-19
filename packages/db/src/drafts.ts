import type { Feature, MatchProfile } from "@redlance/core";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "./client";
import {
  jobPostAnalyses,
  jobPosts,
  matches,
  profileExperience,
  profileProjects,
  profiles,
  profileSkills,
} from "./schema";

// Phase 3 (docs/drafts/plan/03-evidence.md): everything one draft is built from, loaded in
// two rounds. Hidden projects and roles are never loaded; another user's or a withdrawn
// match gives null.

type Executor = Pick<Database, "select" | "selectDistinct">;

export type DraftContext = {
  match: {
    id: string;
    broad: boolean;
    features: Feature[];
    ruleReason: string;
    bestProjectId: string | null;
    bestRoleId: string | null;
  };
  post: {
    id: string;
    title: string;
    body: string;
    community: string;
    url: string;
    /** Other communities the same gig was cross-posted to, sorted. */
    alsoPostedIn: string[];
  };
  analysis: {
    kind: string;
    employmentType: string;
    payType: (typeof jobPostAnalyses.$inferSelect)["payType"];
    categories: string[];
    skillIds: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    currency: string | null;
    budgetUnit: (typeof jobPostAnalyses.$inferSelect)["budgetUnit"];
    remote: string;
    location: string | null;
    deadline: string | null;
    redFlags: string[];
    summary: string;
    applyInstructions: string | null;
  };
  profile: {
    displayName: string;
    experienceLevel: string;
    githubUsername: string | null;
    minRateMinor: number;
    currency: MatchProfile["currency"];
    rateType: MatchProfile["rateType"];
    timeZone: string;
    mentionEmployers: boolean;
    skills: MatchProfile["skills"];
  };
  /**
   * Employers of ALL the user's roles, hidden ones included: for scrubbing names out of the
   * evidence only. A hidden role itself is never loaded into `roles`.
   */
  allOrganisations: {
    organisation: string | null;
    organisationDescription: string;
  }[];
  projects: {
    id: string;
    position: number;
    title: string;
    summary: string;
    skillIds: string[];
    categories: string[];
    domains: string[];
    outcomes: string[];
    links: string[];
    year: number | null;
    hidden: false;
  }[];
  roles: {
    id: string;
    position: number;
    title: string;
    summary: string;
    skillIds: string[];
    categories: string[];
    domains: string[];
    organisation: string | null;
    organisationDescription: string;
    highlights: string[];
    startYear: number | null;
    startMonth: number | null;
    endYear: number | null;
    endMonth: number | null;
    isCurrent: boolean;
    hidden: false;
  }[];
};

export async function loadDraftContext(
  db: Executor,
  opts: { userId: string; matchId: string },
): Promise<DraftContext | null> {
  const [head] = await db
    .select({ m: matches, p: jobPosts, a: jobPostAnalyses, u: profiles })
    .from(matches)
    .innerJoin(jobPosts, eq(jobPosts.id, matches.jobPostId))
    .innerJoin(jobPostAnalyses, eq(jobPostAnalyses.jobPostId, jobPosts.id))
    .innerJoin(profiles, eq(profiles.userId, matches.userId))
    .where(
      and(
        eq(matches.id, opts.matchId),
        eq(matches.userId, opts.userId),
        isNull(matches.withdrawnAt),
      ),
    );
  if (!head) return null;
  const { m, p, a, u } = head;

  const [skills, projects, roles, orgRows, also] = await Promise.all([
    db
      .select({ id: profileSkills.skillId, level: profileSkills.level })
      .from(profileSkills)
      .where(eq(profileSkills.userId, opts.userId)),
    db
      .select()
      .from(profileProjects)
      .where(
        and(
          eq(profileProjects.userId, opts.userId),
          eq(profileProjects.hidden, false),
        ),
      )
      .orderBy(asc(profileProjects.position)),
    db
      .select()
      .from(profileExperience)
      .where(
        and(
          eq(profileExperience.userId, opts.userId),
          eq(profileExperience.hidden, false),
        ),
      )
      .orderBy(asc(profileExperience.position)),
    db
      .select({
        organisation: profileExperience.organisation,
        organisationDescription: profileExperience.organisationDescription,
      })
      .from(profileExperience)
      .where(eq(profileExperience.userId, opts.userId))
      .orderBy(asc(profileExperience.position)),
    db
      .selectDistinct({ community: jobPosts.community })
      .from(jobPosts)
      .where(
        and(
          eq(jobPosts.duplicateOf, p.id),
          ne(jobPosts.community, p.community),
        ),
      )
      .orderBy(asc(jobPosts.community)),
  ]);

  return {
    allOrganisations: orgRows,
    match: {
      id: m.id,
      broad: m.broad,
      features: m.features,
      ruleReason: m.ruleReason,
      bestProjectId: m.bestProjectId,
      bestRoleId: m.bestRoleId,
    },
    post: {
      id: p.id,
      title: p.title,
      body: p.body,
      community: p.community,
      url: p.url,
      alsoPostedIn: also.map((r) => r.community),
    },
    analysis: {
      kind: a.kind,
      employmentType: a.employmentType,
      payType: a.payType,
      categories: a.categories,
      skillIds: a.skillIds,
      budgetMin: a.budgetMin,
      budgetMax: a.budgetMax,
      currency: a.currency,
      budgetUnit: a.budgetUnit,
      remote: a.remote,
      location: a.location,
      deadline: a.deadline,
      redFlags: a.redFlags,
      summary: a.summary,
      applyInstructions: a.applyInstructions,
    },
    profile: {
      displayName: u.displayName,
      experienceLevel: u.experienceLevel,
      githubUsername: u.githubUsername,
      minRateMinor: u.minRateMinor,
      currency: u.currency,
      rateType: u.rateType,
      timeZone: u.timeZone,
      mentionEmployers: u.mentionEmployers,
      skills,
    },
    projects: projects.map((r) => ({
      id: r.id,
      position: r.position,
      title: r.title,
      summary: r.summary,
      skillIds: r.skillIds,
      categories: r.categories,
      domains: r.domains,
      outcomes: r.outcomes,
      links: r.links,
      year: r.year,
      hidden: false as const,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      position: r.position,
      title: r.title,
      summary: r.summary,
      skillIds: r.skillIds,
      categories: r.categories,
      domains: r.domains,
      organisation: r.organisation,
      organisationDescription: r.organisationDescription,
      highlights: r.highlights,
      startYear: r.startYear,
      startMonth: r.startMonth,
      endYear: r.endYear,
      endMonth: r.endMonth,
      isCurrent: r.isCurrent,
      hidden: false as const,
    })),
  };
}
