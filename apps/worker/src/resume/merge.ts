import {
  CATEGORY_IDS,
  DOMAIN_IDS,
  LIMITS,
  ORGANISATION_FREE_TYPES,
  PROJECT_KINDS,
  PROJECT_ROLES,
  ROLE_EMPLOYMENT_TYPES,
  SKILL_BY_ID,
  WORK_LIMITS,
  experienceSuggestion,
  findSkill,
  isCountryCode,
  isUsableSkillName,
  normalizeSkillName,
  projectSuggestion,
  suggestionsSchema,
  type ExperienceSuggestion,
  type ProjectSuggestion,
  type ResumeStepName,
  type Suggestions,
} from "@redlance/core";
import { findRanges, type DateRange } from "./dates";
import { projectYear, type Block } from "./entries";
import { hasEvidence, hasSkillEvidence } from "./evidence";
import {
  cutPartialName,
  DEFAULT_GENERIC,
  findOrganisation,
  linkNamesClient,
  nameOccurs,
  removeNamedUrls,
  replaceNames,
  sharesNameWord,
  type ClientName,
} from "./names";
import { projectLinks, skillLabelOccurs, TLDS } from "./prepass";
import type { ResumeSections } from "./sections";
import type {
  BasicsOutput,
  CopiedLine,
  ExperienceOutput,
  JobTypesOutput,
  ProjectsOutput,
  SkillsOutput,
} from "./step-types";

type Level = "core" | "secondary";

/** Something a step suggested that the merge left out, and why (for the dev console). */
export type DroppedItem = {
  what:
    | "displayName"
    | "headline"
    | "country"
    | "category"
    | "skill"
    | "customSkill"
    // projects and experience
    | "project"
    | "role"
    | "outcome"
    | "highlight"
    | "summary"
    | "organisation"
    | "organisationDescription"
    | "domain"
    | "link";
  value: string;
  reason: string;
  /** The entry block (projects and experience only). */
  block?: string;
};

/**
 * A name taken out of an entry's text (for the dev console). `source` is "model" for a
 * client name the model listed, "organisation" for the role's own organisation.
 */
export type ReplacedName = {
  block: string;
  name: string;
  generic: string;
  source: "model" | "organisation";
};

// Links in a suggested name or headline would be shown (and saved) as the
// user's own words, so they're removed. Scheme/www links match in any case;
// a bare "domain.tld/path" only in lowercase with a common TLD, so tech names
// like "Node.js/React" or "ASP.NET/C#" survive.
const SCHEME_LINK_RE = /(?:https?:\/\/|www\.)\S*/gi;
const PATH_LINK_RE = new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\/\\S*`, "g");
const BARE_DOMAIN_RE = new RegExp(`\\b[a-z0-9-]+\\.(?:${TLDS})\\b`, "i");

export function stripLinks(value: string): string {
  return value
    .replace(SCHEME_LINK_RE, " ")
    .replace(PATH_LINK_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s|·•,;:/-]+|[\s|·•,;:/-]+$/g, "")
    .trim();
}

function isPlainName(name: string): boolean {
  if (name.includes("@")) return false;
  if (/^[\d\s()+.\-]+$/.test(name)) return false; // a phone number or other digits
  if (/https?:\/\/|www\./i.test(name) || BARE_DOMAIN_RE.test(name))
    return false;
  return true;
}

export function mergeResumeSteps(
  steps: {
    basics?: BasicsOutput;
    jobTypes?: JobTypesOutput;
    skills?: SkillsOutput;
    projects?: ProjectsOutput;
    experience?: ExperienceOutput;
  },
  ctx: {
    text: string;
    sections: ResumeSections;
    shortlist: string[];
    yearsExperience: number | null;
    githubUsername: string | null;
    pipelineVersion: string;
    promptVersions: Partial<Record<ResumeStepName, string>>;
    partial: ResumeStepName[];
    /** Steps that didn't run for this resume (no section for them). */
    skipped?: ResumeStepName[];
    projectBlocks?: Block[];
    experienceBlocks?: Block[];
    /** When given, collects what was left out and why. */
    dropped?: DroppedItem[];
    /** When given, collects the names taken out of projects and experience. */
    replaced?: ReplacedName[];
  },
): Suggestions {
  const drop = (what: DroppedItem["what"], value: string, reason: string) =>
    ctx.dropped?.push({ what, value, reason });
  const basics: Record<string, unknown> = {};
  const displayName = steps.basics?.displayName
    ?.trim()
    .slice(0, LIMITS.displayName);
  if (displayName && isPlainName(displayName)) basics.displayName = displayName;
  else if (displayName)
    drop("displayName", displayName, "looks like contact details or a link");
  const rawHeadline = steps.basics?.headline?.trim() ?? "";
  const headline = stripLinks(rawHeadline).slice(0, LIMITS.headline).trim();
  if (headline) basics.headline = headline;
  else if (rawHeadline) drop("headline", rawHeadline, "only links");
  const country = steps.basics?.country?.trim().toUpperCase();
  if (country && isCountryCode(country)) basics.country = country;
  else if (country) drop("country", country, "not a known country code");

  const categories: string[] = [];
  for (const c of steps.jobTypes?.categories ?? []) {
    if (categories.includes(c.id)) continue;
    if (!hasEvidence(ctx.text, c.evidence))
      drop("category", c.id, "evidence not found in the text");
    else if (categories.length >= LIMITS.categories)
      drop("category", c.id, `over the limit of ${LIMITS.categories}`);
    else categories.push(c.id);
  }
  if (categories.length) basics.categories = categories;

  const y = ctx.yearsExperience;
  const level =
    y !== null
      ? y < 1
        ? "beginner"
        : y <= 3
          ? "intermediate"
          : "experienced"
      : steps.jobTypes?.experienceLevel;
  if (level) basics.experienceLevel = level;

  const shortlist = new Set(ctx.shortlist);
  const skills = new Map<string, Level>();
  const custom = new Map<string, { name: string; level: Level }>();
  const add = (id: string, lvl: Level) => {
    const have = skills.get(id);
    if (!have || lvl === "core") skills.set(id, lvl);
  };

  for (const sk of steps.skills?.skills ?? []) {
    const known = SKILL_BY_ID.get(sk.id);
    if (!known || known.retired) {
      drop("skill", sk.id, known ? "retired id" : "unknown id");
      continue;
    }
    if (
      hasSkillEvidence(ctx.text, sk.evidence, [known.name, ...known.aliases]) ||
      (shortlist.has(sk.id) && skillLabelOccurs(known, ctx.sections.skills))
    )
      add(sk.id, sk.level);
    else drop("skill", sk.id, "evidence not found in the text");
  }
  for (const c of steps.skills?.customSkills ?? []) {
    const known = findSkill(c.name);
    const labels = known ? [known.name, ...known.aliases, c.name] : [c.name];
    if (!hasSkillEvidence(ctx.text, c.evidence, labels)) {
      drop("customSkill", c.name, "evidence not found in the text");
      continue;
    }
    if (known) {
      if (!known.retired) add(known.id, c.level);
      else drop("customSkill", c.name, `matches retired id ${known.id}`);
      continue;
    }
    const name = c.name.trim();
    if (!isUsableSkillName(name)) {
      drop("customSkill", c.name, "not a usable skill name");
      continue;
    }
    const key = normalizeSkillName(name);
    const have = custom.get(key);
    if (!have) custom.set(key, { name, level: c.level });
    else if (c.level === "core") have.level = "core";
  }

  let core = 0;
  const cap = (lvl: Level): Level => {
    if (lvl !== "core") return lvl;
    core += 1;
    return core > LIMITS.coreSkills ? "secondary" : "core";
  };
  const skillList = [...skills]
    .slice(0, LIMITS.totalSkills)
    .map(([id, lvl]) => ({ id, level: cap(lvl) }));
  for (const [id] of [...skills].slice(LIMITS.totalSkills))
    drop("skill", id, `over the limit of ${LIMITS.totalSkills}`);
  const customCap = Math.min(10, LIMITS.totalSkills - skillList.length);
  const customList = [...custom.values()]
    .slice(0, customCap)
    .map((c) => ({ name: c.name, level: cap(c.level) }));
  for (const c of [...custom.values()].slice(customCap))
    drop("customSkill", c.name, "over the skill limit");

  const { projects, experience } = mergeWork(
    { projects: steps.projects, experience: steps.experience },
    {
      projectBlocks: ctx.projectBlocks ?? [],
      experienceBlocks: ctx.experienceBlocks ?? [],
      shortlist: ctx.shortlist,
      dropped: ctx.dropped,
      replaced: ctx.replaced,
    },
  );

  return suggestionsSchema.parse({
    v: 2,
    meta: {
      pipelineVersion: ctx.pipelineVersion,
      promptVersions: ctx.promptVersions,
      partial: ctx.partial,
      skipped: ctx.skipped ?? [],
    },
    basics,
    skills: skillList,
    customSkills: customList,
    githubUsername: ctx.githubUsername,
    projects,
    experience,
  });
}

// ---------- projects and experience ----------

const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const tidy = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

/**
 * Shortens text to `max` UTF-16 units (what the schemas count) at a word boundary, with "…".
 * Cuts between code points, so an emoji is never split into a lone surrogate.
 */
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = "";
  for (const ch of text) {
    if (cut.length + ch.length > max - 1) break;
    cut += ch;
  }
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The value appears in the block, ignoring case and spacing (titles). */
const inBlock = (block: Block, value: string) => {
  const v = norm(value);
  return v.length >= 2 && norm(block.text).includes(v);
};

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
/** An email address, or a run of 9+ digits written like a phone number. */
function hasContactDetails(text: string): boolean {
  if (EMAIL_RE.test(text)) return true;
  for (const m of text.matchAll(PHONE_RE))
    if ((m[0].match(/\d/g)?.length ?? 0) >= 9) return true;
  return false;
}

/** Fewer than 2 words left: not worth keeping as a line. */
const tooShort = (s: string) => (s.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) < 2;

type WorkCtx = {
  projectBlocks: Block[];
  experienceBlocks: Block[];
  shortlist: string[];
  dropped?: DroppedItem[];
  replaced?: ReplacedName[];
};

/** One entry's checks: names verified against its block, replacements recorded. */
class EntryScrub {
  readonly names: ClientName[] = [];
  readonly sources = new Map<string, ReplacedName>();
  removed = false;

  constructor(readonly block: Block) {}

  /** Adds the model's names that really occur in the block. */
  addNames(names: ClientName[]): void {
    for (const c of names)
      if (nameOccurs(this.block.text, c.name))
        this.names.push({ name: c.name, generic: c.generic });
  }

  /** Adds the names the model listed on the entry's lines (dropped lines count too). */
  addLineNames(lines: CopiedLine[]): void {
    for (const l of lines) this.addNames(l.clientNames);
  }

  /** Every name of the entry, as plain strings. */
  get nameList(): string[] {
    return this.names.map((n) => n.name);
  }

  /** Replaces every name of the entry in `text`; links that name a client go first. */
  apply(text: string): string {
    if (!text || this.names.length === 0) return text;
    const unlinked = removeNamedUrls(text, this.nameList);
    if (unlinked !== text) this.removed = true;
    const r = replaceNames(unlinked, this.names);
    for (const p of r.pairs) {
      this.removed = true;
      const k = norm(p.name);
      if (!this.sources.has(k))
        this.sources.set(k, {
          block: this.block.id,
          name: p.name,
          generic: p.generic,
          source: "model",
        });
    }
    return r.text;
  }

  /** The block's links, minus any that name a client. */
  links(links: string[]): string[] {
    const kept = links.filter((l) => !linkNamesClient(l, this.nameList));
    if (kept.length < links.length) this.removed = true;
    return kept;
  }
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
const oneOf = <T extends string>(list: readonly T[], v: string, d: T): T =>
  (list as readonly string[]).includes(v) ? (v as T) : d;

/**
 * Where an entry sits in its block. When several entries share one block (DOCX drops list
 * bullets, so one-line projects run together), each owns only the lines from its title to
 * the next entry's title. `own` is null for an entry alone in its block (it owns all of it)
 * and empty for one whose title isn't on a single line.
 */
type Span = { own: string | null; first: boolean };

function spansFor(items: { block?: Block; title: string }[]): Span[] {
  const spans: Span[] = items.map(() => ({ own: null, first: true }));
  const groups = new Map<Block, number[]>();
  items.forEach((it, i) => {
    if (!it.block || !inBlock(it.block, it.title)) return;
    groups.set(it.block, [...(groups.get(it.block) ?? []), i]);
  });
  for (const [block, idx] of groups) {
    if (idx.length < 2) continue;
    const lines = block.text.split("\n");
    const at = idx.map((i) =>
      lines.findIndex((l) => norm(l).includes(norm(items[i]!.title))),
    );
    const starts = unique(at.filter((p) => p >= 0)).sort((a, b) => a - b);
    const firstAt = starts[0];
    idx.forEach((i, k) => {
      const p = at[k]!;
      if (p < 0) {
        spans[i] = { own: "", first: false };
        return;
      }
      const next = starts.find((s) => s > p) ?? lines.length;
      // Entries on the same title line are one entry listed twice (the dedupe drops one).
      const first = p === firstAt;
      spans[i] = { own: lines.slice(p, next).join("\n"), first };
    });
  }
  return spans;
}

/**
 * Projects and experience from the two model steps, checked against their own blocks
 * (projects-experience-design.md, "Checks and merge" and "Removing client names").
 * Never throws: anything that fails a check is dropped and recorded.
 */
export function mergeWork(
  steps: { projects?: ProjectsOutput; experience?: ExperienceOutput },
  ctx: WorkCtx,
): { projects: ProjectSuggestion[]; experience: ExperienceSuggestion[] } {
  const drop = (
    what: DroppedItem["what"],
    value: string,
    reason: string,
    block: string,
  ) => ctx.dropped?.push({ what, value, reason, block });
  const shortlist = new Set(ctx.shortlist);
  const order = (blocks: Block[]) => new Map(blocks.map((b, i) => [b.id, i]));
  const projectOrder = order(ctx.projectBlocks);
  const roleOrder = order(ctx.experienceBlocks);
  const byId = new Map(
    [...ctx.projectBlocks, ...ctx.experienceBlocks].map((b) => [b.id, b]),
  );

  const skillsFor = (ids: string[], block: Block) => {
    const out: string[] = [];
    for (const id of unique(ids)) {
      const skill = SKILL_BY_ID.get(id);
      if (!shortlist.has(id) || !skill || skill.retired)
        drop("skill", id, "not on the shortlist", block.id);
      else if (!skillLabelOccurs(skill, block.text))
        drop("skill", id, "label not in its block", block.id);
      else out.push(id);
    }
    return out.slice(0, WORK_LIMITS.entrySkills);
  };
  const tagsFor = (
    e: { categories: string[]; domains: string[] },
    block: Block,
  ) => ({
    categories: unique(e.categories)
      .filter((c) => (CATEGORY_IDS as readonly string[]).includes(c))
      .slice(0, WORK_LIMITS.entryCategories),
    domains: unique(e.domains)
      .filter((d) => {
        const ok = (DOMAIN_IDS as readonly string[]).includes(d);
        if (!ok) drop("domain", d, "not a known domain", block.id);
        return ok;
      })
      .slice(0, WORK_LIMITS.domains),
  });
  /**
   * Lines kept only when word for word in the block (checked before any change). Then a
   * name cut off at the end, and links naming a client, are removed; a line with little
   * left is dropped. Then every name is replaced.
   */
  const finishLines = (
    lines: CopiedLine[],
    scrub: EntryScrub,
    what: "outcome" | "highlight",
    max: number,
  ) => {
    const out: string[] = [];
    for (const l of lines) {
      if (!hasEvidence(scrub.block.text, l.text)) {
        drop(what, l.text, "not word for word in its block", scrub.block.id);
        continue;
      }
      const text = tidy(l.text);
      const cut = cutPartialName(
        removeNamedUrls(text, scrub.nameList),
        scrub.nameList,
      );
      if (cut !== text) scrub.removed = true;
      if (tooShort(cut)) {
        drop(
          what,
          l.text,
          "little left without the client name",
          scrub.block.id,
        );
        continue;
      }
      out.push(fit(scrub.apply(cut), WORK_LIMITS.entrySummary));
    }
    return unique(out).slice(0, max);
  };
  const cleanSummary = (summary: string, block: Block) => {
    const s = stripLinks(tidy(summary));
    if (hasContactDetails(s)) {
      drop("summary", summary, "contact details", block.id);
      return "";
    }
    return s;
  };

  type Kept<T> = {
    value: T;
    block: Block;
    key: string;
    label: string;
    scrub: EntryScrub;
  };

  // ----- projects -----
  const projects: Kept<ProjectSuggestion>[] = [];
  const projectItems = steps.projects?.projects ?? [];
  const projectSpans = spansFor(
    projectItems.map((p) => ({
      block: projectOrder.has(p.block) ? byId.get(p.block) : undefined,
      title: tidy(p.title),
    })),
  );
  projectItems.forEach((p, i) => {
    const block = projectOrder.has(p.block) ? byId.get(p.block) : undefined;
    const rawTitle = tidy(p.title);
    if (!block) {
      drop("project", p.title, "unknown block", p.block);
      return;
    }
    if (!inBlock(block, rawTitle)) {
      drop("project", p.title, "title not in its block", block.id);
      return;
    }
    const scrub = new EntryScrub(block);
    scrub.addNames(p.clientNames ?? []);
    scrub.addLineNames(p.outcomes);
    // Entries sharing a block keep only the links and year on their own lines.
    const { own } = projectSpans[i]!;
    const ownLinks = own === null ? null : projectLinks(own);
    const links = ownLinks
      ? block.links.filter((l) => ownLinks.includes(l))
      : block.links;
    const year =
      own === null
        ? block.year
        : projectYear(own, findRanges(own)[0] ?? null, new Date());
    const value = projectSuggestion.safeParse({
      title: fit(scrub.apply(rawTitle), WORK_LIMITS.entryTitle),
      summary: fit(
        scrub.apply(cleanSummary(p.summary, block)),
        WORK_LIMITS.entrySummary,
      ),
      role: oneOf(PROJECT_ROLES, p.role, "unknown"),
      kind: oneOf(PROJECT_KINDS, p.kind, "unknown"),
      skills: skillsFor(p.skills, block),
      ...tagsFor(p, block),
      outcomes: finishLines(p.outcomes, scrub, "outcome", WORK_LIMITS.outcomes),
      links: scrub.links(links),
      year,
      namesRemoved: false,
    });
    if (!value.success) {
      drop("project", p.title, "failed the suggestion schema", block.id);
      return;
    }
    for (const l of links)
      if (!value.data.links.includes(l))
        drop("link", l, "names a client", block.id);
    value.data.namesRemoved = scrub.removed;
    projects.push({
      value: value.data,
      block,
      key: norm(rawTitle),
      label: p.title,
      scrub,
    });
  });

  // ----- experience -----
  const roles: Kept<ExperienceSuggestion>[] = [];
  const roleItems = steps.experience?.experience ?? [];
  const roleSpans = spansFor(
    roleItems.map((r) => ({
      block: roleOrder.has(r.block) ? byId.get(r.block) : undefined,
      title: tidy(r.title),
    })),
  );
  roleItems.forEach((r, i) => {
    const block = roleOrder.has(r.block) ? byId.get(r.block) : undefined;
    const rawTitle = tidy(r.title);
    if (!block) {
      drop("role", r.title, "unknown block", r.block);
      return;
    }
    if (!inBlock(block, rawTitle)) {
      drop("role", r.title, "title not in its block", block.id);
      return;
    }
    const employmentType = oneOf(
      ROLE_EMPLOYMENT_TYPES,
      r.employmentType,
      "unknown",
    );
    const orgFree = ORGANISATION_FREE_TYPES.has(employmentType);
    const scrub = new EntryScrub(block);
    scrub.addNames(r.clientNames ?? []);
    scrub.addLineNames(r.highlights);
    const modelOrg = tidy(r.organisation ?? "");
    // As the block writes it, retried without a legal suffix or trailing words.
    const organisation = modelOrg
      ? findOrganisation(block.text, modelOrg)
      : null;
    if (modelOrg && !organisation) {
      drop("organisation", modelOrg, "not in its block", block.id);
      // A freelance or contract organisation is often a client: ask the user to check.
      if (orgFree) scrub.removed = true;
    }

    const fallback = orgFree ? DEFAULT_GENERIC : "a company";
    let description = tidy(r.organisationDescription);
    const listed = [
      ...scrub.nameList,
      ...(modelOrg ? [modelOrg] : []),
      ...(organisation ? [organisation] : []),
    ];
    if (description && sharesNameWord(description, listed)) {
      drop(
        "organisationDescription",
        description,
        "shares a word with a name",
        block.id,
      );
      description = fallback;
    }
    // Backup that doesn't rely on the model: the organisation's own name leaves every text
    // field, for every employment type (the name stays in `organisation` unless the role is
    // freelance or contract, so mention_employers can use it later).
    if (organisation)
      for (const name of unique([organisation, modelOrg]))
        scrub.names.push({ name, generic: description || fallback });

    // Entries sharing a block: the block's dates belong to the first role only, unless a
    // role's own lines carry a range.
    const span = roleSpans[i]!;
    const ownRange: DateRange | null =
      span.own === null
        ? block.range
        : (findRanges(span.own)[0] ?? (span.first ? block.range : null));
    const value = experienceSuggestion.safeParse({
      title: fit(scrub.apply(rawTitle), WORK_LIMITS.entryTitle),
      organisation: orgFree ? null : organisation,
      organisationDescription: fit(
        scrub.apply(description),
        WORK_LIMITS.orgDescription,
      ),
      employmentType,
      start: ownRange?.start ?? null,
      end: ownRange?.end ?? null,
      current: ownRange?.current ?? false,
      summary: fit(
        scrub.apply(cleanSummary(r.summary, block)),
        WORK_LIMITS.entrySummary,
      ),
      highlights: finishLines(
        r.highlights,
        scrub,
        "highlight",
        WORK_LIMITS.highlights,
      ),
      skills: skillsFor(r.skills, block),
      ...tagsFor(r, block),
      namesRemoved: false,
    });
    if (!value.success) {
      drop("role", r.title, "failed the suggestion schema", block.id);
      return;
    }
    // The organisation's name counts as the model's when the model listed it too.
    const modelListed = new Set(
      [
        ...(r.clientNames ?? []),
        ...r.highlights.flatMap((l) => l.clientNames),
      ].map((c) => norm(c.name)),
    );
    for (const name of [organisation, modelOrg]) {
      const rec = name ? scrub.sources.get(norm(name)) : undefined;
      if (rec && !modelListed.has(norm(name!))) rec.source = "organisation";
    }
    value.data.namesRemoved = scrub.removed;
    roles.push({
      value: value.data,
      block,
      key: [
        norm(rawTitle),
        norm(organisation ?? ""),
        ownRange?.start.year,
        ownRange?.start.month,
      ].join("|"),
      label: r.title,
      scrub,
    });
  });

  const finish = <T>(
    list: Kept<T>[],
    rank: Map<string, number>,
    what: "project" | "role",
    max: number,
  ): T[] => {
    // Resume order (block order); sort is stable for entries from one block.
    list.sort((a, b) => rank.get(a.block.id)! - rank.get(b.block.id)!);
    const seen = new Set<string>();
    const out: T[] = [];
    for (const e of list) {
      if (seen.has(e.key)) {
        drop(what, e.label, "duplicate title", e.block.id);
        continue;
      }
      seen.add(e.key);
      if (out.length >= max) {
        drop(what, e.label, `over the limit of ${max}`, e.block.id);
        continue;
      }
      out.push(e.value);
      ctx.replaced?.push(...e.scrub.sources.values());
    }
    return out;
  };

  return {
    projects: finish(projects, projectOrder, "project", WORK_LIMITS.projects),
    experience: finish(roles, roleOrder, "role", WORK_LIMITS.roles),
  };
}
