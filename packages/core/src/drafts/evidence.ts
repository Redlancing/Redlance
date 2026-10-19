import { scrubOrganisations } from "../client-names";
import type { Feature, MatchPost, MatchProfile } from "../matching/score";
import { budgetFit } from "../matching/score";
import { SKILL_BY_ID } from "../taxonomy";
import { DOMAINS } from "../work";
import type {
  Evidence,
  EvidenceProject,
  EvidenceRole,
  RateNote,
} from "./types";

// Phase 3 (docs/drafts/plan/03-evidence.md): picks the few facts one draft is written from and
// enforces the privacy rules (hidden entries and employer names never reach the model). Pure.

/** Ranking weights: a post skill the user lists as core counts 3, any other 1. */
export const RANK_WEIGHTS = {
  coreSkill: 3,
  otherSkill: 1,
  category: 2,
  domain: 1,
} as const;

/** A deadline this many days away or fewer (and not past) means the user can start this week. */
export const AVAILABILITY_DAYS = 7;
export const MAX_MENTIONED_SKILLS = 3;
const DAY_MS = 86_400_000;

type EntryInput = {
  id: string;
  position: number;
  title: string;
  summary: string;
  skillIds: string[];
  categories: string[];
  domains: string[];
  hidden: boolean;
};

export type EvidenceProjectInput = EntryInput & {
  outcomes: string[];
  links: string[];
  year: number | null;
};

export type EvidenceRoleInput = EntryInput & {
  organisation: string | null;
  organisationDescription: string;
  highlights: string[];
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  isCurrent: boolean;
};

export type EvidenceInput = {
  /** Defaults to the current time. */
  now?: Date;
  /** `title` and the analysis `summary` are only read to spot a domain (e.g. "e-commerce"). */
  post: { title: string; summary: string };
  analysis: Pick<
    MatchPost,
    | "payType"
    | "categories"
    | "skillIds"
    | "budgetMin"
    | "budgetMax"
    | "currency"
    | "budgetUnit"
    | "deadline"
    | "redFlags"
  >;
  match: {
    broad: boolean;
    features: Feature[];
    bestProjectId: string | null;
    bestRoleId: string | null;
  };
  profile: {
    skills: MatchProfile["skills"];
    githubUsername: string | null;
    mentionEmployers: boolean;
    minRateMinor: number;
    currency: MatchProfile["currency"];
    rateType: MatchProfile["rateType"];
  };
  projects: EvidenceProjectInput[];
  roles: EvidenceRoleInput[];
  /**
   * Employers of ALL the user's roles, hidden ones included. Used only to scrub names and fill
   * `organisationNames`; a hidden role never becomes `role` or appears in the evidence text.
   */
  allOrganisations?: {
    organisation: string | null;
    organisationDescription: string;
  }[];
  exclude?: { projectIds: string[] };
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Domain ids whose name, label or an alias occurs as a whole word in the post's text. */
function postDomains(text: string): Set<string> {
  const found = new Set<string>();
  for (const d of DOMAINS) {
    const terms = [d.id, d.label, ...d.aliases];
    if (
      terms.some((t) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`,
          "iu",
        ).test(text),
      )
    )
      found.add(d.id);
  }
  return found;
}

type Ranked<T> = { entry: T; score: number };

function scoreEntry(
  e: EntryInput,
  postSkills: ReadonlySet<string>,
  coreSkills: ReadonlySet<string>,
  postCategories: ReadonlySet<string>,
  domains: ReadonlySet<string>,
): number {
  let score = 0;
  for (const id of new Set(e.skillIds)) {
    if (!postSkills.has(id)) continue;
    score += coreSkills.has(id)
      ? RANK_WEIGHTS.coreSkill
      : RANK_WEIGHTS.otherSkill;
  }
  for (const c of new Set(e.categories))
    if (postCategories.has(c)) score += RANK_WEIGHTS.category;
  for (const d of new Set(e.domains))
    if (domains.has(d)) score += RANK_WEIGHTS.domain;
  return score;
}

/** Visible projects, best first: skills, then categories, then domains; ties by year, then position. */
export function rankProjects(
  projects: readonly EvidenceProjectInput[],
  input: Pick<EvidenceInput, "post" | "analysis" | "profile">,
): Ranked<EvidenceProjectInput>[] {
  const ctx = rankContext(input);
  return projects
    .filter((p) => !p.hidden)
    .map((entry) => ({ entry, score: scoreEntry(entry, ...ctx) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.entry.year ?? -Infinity) - (a.entry.year ?? -Infinity) ||
        a.entry.position - b.entry.position,
    );
}

/** The same for roles; ties go to the current role, then the latest end date, then position. */
export function rankRoles(
  roles: readonly EvidenceRoleInput[],
  input: Pick<EvidenceInput, "post" | "analysis" | "profile">,
): Ranked<EvidenceRoleInput>[] {
  const ctx = rankContext(input);
  const endKey = (r: EvidenceRoleInput) =>
    r.isCurrent
      ? Infinity
      : r.endYear === null
        ? -Infinity
        : r.endYear * 12 + (r.endMonth ?? 12);
  return roles
    .filter((r) => !r.hidden)
    .map((entry) => ({ entry, score: scoreEntry(entry, ...ctx) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        endKey(b.entry) - endKey(a.entry) ||
        a.entry.position - b.entry.position,
    );
}

function rankContext(
  input: Pick<EvidenceInput, "post" | "analysis" | "profile">,
) {
  return [
    new Set(input.analysis.skillIds),
    new Set(
      input.profile.skills.filter((s) => s.level === "core").map((s) => s.id),
    ),
    new Set(input.analysis.categories),
    postDomains(`${input.post.title}\n${input.post.summary}`),
  ] as const;
}

/** Skill ids the rule score matched, in the post's own order, top 3, as names. */
function mentionedSkills(input: EvidenceInput): string[] {
  if (input.match.broad) return [];
  const matched = new Set<string>();
  for (const f of input.match.features)
    if (
      f.signal === "core_skill" ||
      f.signal === "secondary_skill" ||
      f.signal === "work_overlap"
    )
      for (const id of f.detail ?? []) matched.add(id);
  const names: string[] = [];
  for (const id of new Set(input.analysis.skillIds)) {
    if (!matched.has(id)) continue;
    const name = SKILL_BY_ID.get(id)?.name;
    if (name) names.push(name);
    if (names.length === MAX_MENTIONED_SKILLS) break;
  }
  return names;
}

function rateNote(input: EvidenceInput): RateNote {
  const a = input.analysis;
  const post: MatchPost = {
    postedAt: new Date(0),
    kind: "hiring",
    employmentType: "unknown",
    payType: a.payType,
    categories: a.categories,
    skillIds: a.skillIds,
    budgetMin: a.budgetMin,
    budgetMax: a.budgetMax,
    currency: a.currency,
    budgetUnit: a.budgetUnit,
    remote: "unknown",
    deadline: a.deadline,
    redFlags: a.redFlags,
  };
  const profile: MatchProfile = {
    categories: [],
    skills: input.profile.skills,
    workSkillIds: [],
    minRateMinor: input.profile.minRateMinor,
    currency: input.profile.currency,
    rateType: input.profile.rateType,
    remoteOnly: false,
    includeUnpaid: true,
  };
  return budgetFit(post, profile) === "fits"
    ? { mention: true, text: "the posted budget fits your rate" }
    : { mention: false };
}

function availability(deadline: string | null, now: Date): string | null {
  if (deadline === null) return null;
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + AVAILABILITY_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return deadline >= today && deadline <= limit ? "can start this week" : null;
}

function budgetText(a: EvidenceInput["analysis"]): string | null {
  if (a.budgetMin === null && a.budgetMax === null) return null;
  const range =
    a.budgetMin !== null && a.budgetMax !== null && a.budgetMin !== a.budgetMax
      ? `${a.budgetMin}-${a.budgetMax}`
      : String(a.budgetMax ?? a.budgetMin);
  return `Posted budget: ${[range, a.currency, a.budgetUnit].filter(Boolean).join(" ")}`;
}

function years(r: EvidenceRole): string | null {
  const start = r.startYear;
  const end = r.isCurrent ? "present" : r.endYear;
  if (start === null && end === null) return null;
  return `${start ?? "?"}-${end ?? "?"}`;
}

/** Red flags a pay type adds on its own: unpaid, commission-only and revenue-share work. */
export function payTypeRedFlags(payType: string): string[] {
  return payType === "unpaid" ||
    payType === "commission_only" ||
    payType === "revshare"
    ? [payType]
    : [];
}

/** The analysis's red flags plus those from its pay type, without repeats. The user sees them; the prompt does not. */
export function draftRedFlags(a: {
  payType: string;
  redFlags: readonly string[];
}): string[] {
  const flags = [...a.redFlags];
  // The spec also names "portfolio_only", but PAY_TYPES has no such value.
  for (const f of payTypeRedFlags(a.payType))
    if (!flags.includes(f)) flags.push(f);
  return flags;
}

export function buildEvidence(input: EvidenceInput): Evidence {
  const now = input.now ?? new Date();
  const allowed = input.profile.mentionEmployers;
  const exclude = new Set(input.exclude?.projectIds ?? []);

  const rankedProjects = rankProjects(input.projects, input);
  const rankedRoles = rankRoles(input.roles, input);
  const bestProject = input.match.bestProjectId
    ? rankedProjects.find(
        (r) =>
          r.entry.id === input.match.bestProjectId && !exclude.has(r.entry.id),
      )
    : undefined;
  const chosenProject =
    bestProject?.entry ??
    rankedProjects.find((r) => r.score > 0 && !exclude.has(r.entry.id))
      ?.entry ??
    null;
  const bestRole = input.match.bestRoleId
    ? rankedRoles.find((r) => r.entry.id === input.match.bestRoleId)
    : undefined;
  const chosenRole =
    bestRole?.entry ?? rankedRoles.find((r) => r.score > 0)?.entry ?? null;

  // Employer names come from every role passed in, so a name in an unchosen role or in a
  // project text is scrubbed too.
  const orgs = [...input.roles, ...(input.allOrganisations ?? [])].map((r) => ({
    organisation: r.organisation,
    description: r.organisationDescription,
  }));
  const organisationNames = [
    ...new Set(orgs.map((o) => o.organisation).filter((o): o is string => !!o)),
  ];
  const clean = (text: string) =>
    allowed ? text : scrubOrganisations(text, orgs);

  const project: EvidenceProject | null = chosenProject && {
    id: chosenProject.id,
    title: clean(chosenProject.title),
    summary: chosenProject.summary ? clean(chosenProject.summary) : null,
    outcomes: chosenProject.outcomes.map(clean),
    skills: skillNames(chosenProject.skillIds),
    link: chosenProject.links[0] ?? null,
    year: chosenProject.year,
  };
  const role: EvidenceRole | null = chosenRole && {
    id: chosenRole.id,
    title: clean(chosenRole.title),
    organisation: allowed ? chosenRole.organisation : null,
    organisationDescription: chosenRole.organisationDescription,
    highlights: chosenRole.highlights.map(clean),
    startYear: chosenRole.startYear,
    endYear: chosenRole.endYear,
    isCurrent: chosenRole.isCurrent,
  };

  const skills = mentionedSkills(input);
  const link =
    project?.link ??
    (input.profile.githubUsername
      ? `https://github.com/${input.profile.githubUsername}`
      : null);
  const rate = rateNote(input);
  const avail = availability(input.analysis.deadline, now);

  const redFlags = draftRedFlags(input.analysis);

  const lines: string[] = [];
  if (project) {
    lines.push(
      `Project: ${project.title}${project.year ? ` (${project.year})` : ""}`,
    );
    if (chosenProject?.summary)
      lines.push(`Project summary: ${project.summary}`);
    for (const o of project.outcomes) lines.push(`Project outcome: ${o}`);
    if (project.skills.length)
      lines.push(`Project skills: ${project.skills.join(", ")}`);
  }
  if (role) {
    lines.push(`Role: ${role.title}`);
    lines.push(
      role.organisation
        ? `Employer: ${role.organisation}`
        : `Employer description: ${role.organisationDescription}`,
    );
    const span = years(role);
    if (span) lines.push(`Role dates: ${span}`);
    for (const h of role.highlights) lines.push(`Role highlight: ${h}`);
  }
  if (skills.length) lines.push(`Skills to mention: ${skills.join(", ")}`);
  const budget = budgetText(input.analysis);
  if (budget) lines.push(budget);
  if (rate.mention) lines.push(`Rate: ${rate.text}`);
  if (input.analysis.deadline)
    lines.push(`Deadline: ${input.analysis.deadline}`);
  if (avail) lines.push(`Availability: ${avail}`);

  return {
    project,
    role,
    skills,
    allowedLinks: link ? [link] : [],
    rateNote: rate,
    availability: avail,
    redFlags,
    broad: input.match.broad,
    employerNamesAllowed: allowed,
    organisationNames,
    evidenceText: lines.join("\n"),
    summary: {
      projectTitle: project?.title ?? null,
      roleTitle: role?.title ?? null,
      skills,
    },
    citedProjectIds: [
      ...new Set([...exclude, ...(project ? [project.id] : [])]),
    ],
  };
}

function skillNames(ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const name = SKILL_BY_ID.get(id)?.name;
    return name ? [name] : [];
  });
}
