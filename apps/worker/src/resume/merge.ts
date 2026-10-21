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
  isCountryCode,
  projectSuggestion,
  suggestionsSchema,
  type ExperienceSuggestion,
  type ProjectSuggestion,
  type ResumeStepName,
  type Suggestions,
} from "@redlance/core";
import {
  resolveRanges,
  stripMarker,
  type Block,
  type LineRange,
  type SectionLines,
} from "./entries";
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
  MAX_GENERIC_CHARS,
  type ClientName,
} from "./names";
import { skillLabelOccurs, TLDS } from "./prepass";
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
    // projects and experience
    | "project"
    | "role"
    | "outcome"
    | "highlight"
    | "summary"
    | "organisation"
    | "organisationDescription"
    | "domain"
    | "link"
    // a range the model gave that code had to fix (the entry itself is kept)
    | "lines";
  value: string;
  reason: string;
  /** The entry's lines, like "P3–P7" ("projects" / "experience": the whole section). */
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
    /** By call (profile, skills, work); older results keyed them by step. */
    promptVersions: Record<string, string>;
    partial: ResumeStepName[];
    /** Steps that didn't run for this resume (no section for them). */
    skipped?: ResumeStepName[];
    projectLines?: SectionLines | null;
    experienceLines?: SectionLines | null;
    /** When given, collects what was left out and why. */
    dropped?: DroppedItem[];
    /** When given, collects the names taken out of projects and experience. */
    replaced?: ReplacedName[];
  },
): Suggestions {
  const drop = (what: DroppedItem["what"], value: string, reason: string) =>
    ctx.dropped?.push({ what, value, reason });
  const basics: Record<string, unknown> = {};
  const rawName = steps.basics?.displayName?.trim() ?? "";
  // Checked on the full text, then trimmed.
  const displayName =
    rawName && isPlainName(rawName)
      ? fit(rawName, LIMITS.displayName)
      : rawName;
  if (displayName && isPlainName(displayName)) basics.displayName = displayName;
  else if (displayName)
    drop("displayName", displayName, "looks like contact details or a link");
  const rawHeadline = steps.basics?.headline?.trim() ?? "";
  const headline = fit(stripLinks(rawHeadline).trim(), LIMITS.headline);
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

  const { projects, experience } = mergeWork(
    { projects: steps.projects, experience: steps.experience },
    {
      projectLines: ctx.projectLines ?? null,
      experienceLines: ctx.experienceLines ?? null,
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
  projectLines: SectionLines | null;
  experienceLines: SectionLines | null;
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
        this.names.push({
          name: c.name,
          generic: fit(c.generic, MAX_GENERIC_CHARS),
        });
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
 * Each entry's block from the model's line range (see `resolveRanges`), with the notes and
 * drops it caused, and the entry's place in the resume (its first line; the whole-section
 * fallback goes where its title first appears). An entry whose title isn't in its own range
 * is dropped first, so an invented entry can't take lines from a real one.
 */
function blocksFor(
  items: { lines: LineRange; title: string }[],
  section: SectionLines | null,
  what: "project" | "role",
  drop: (w: DroppedItem["what"], v: string, r: string, b: string) => void,
): ({ block: Block; rank: number } | null)[] {
  if (!section) {
    for (const it of items)
      drop(
        what,
        it.title,
        "its section isn't in the resume",
        what === "project" ? "projects" : "experience",
      );
    return items.map(() => null);
  }
  const titleOf = (it: { title: string }) => tidy(stripMarker(it.title));
  const kept: number[] = [];
  items.forEach((it, i) => {
    const [alone] = resolveRanges([it.lines], section);
    if (alone?.ok && !inBlock(alone.block, titleOf(it)))
      drop(what, it.title, "title not in its lines", alone.block.id);
    else kept.push(i);
  });
  const resolved = resolveRanges(
    kept.map((i) => items[i]!.lines),
    section,
  );
  const out: ({ block: Block; rank: number } | null)[] = items.map(() => null);
  resolved.forEach((r, k) => {
    const i = kept[k]!;
    const title = items[i]!.title;
    if (!r.ok) {
      drop(what, title, r.reason, section.kind);
      return;
    }
    for (const note of r.notes) drop("lines", title, note, r.block.id);
    if (r.from !== null) {
      out[i] = { block: r.block, rank: r.from };
      return;
    }
    const t = norm(titleOf(items[i]!));
    const at = section.lines.findIndex((l) => t && norm(l).includes(t));
    out[i] = {
      block: r.block,
      rank: at < 0 ? Number.MAX_SAFE_INTEGER : at + 1,
    };
  });
  return out;
}

/**
 * Projects and experience from the work call, each checked against its own lines (the
 * range the model gave, checked by code; projects-experience-design.md, "Checks and merge"
 * and "Removing client names").
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

  const skillsFor = (ids: string[], block: Block) => {
    const out: string[] = [];
    for (const id of unique(ids)) {
      const skill = SKILL_BY_ID.get(id);
      if (!shortlist.has(id) || !skill || skill.retired)
        drop("skill", id, "not on the shortlist", block.id);
      else if (!skillLabelOccurs(skill, block.text))
        drop("skill", id, "label not in its lines", block.id);
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
    for (const raw of lines) {
      const l = { ...raw, text: stripMarker(raw.text) };
      if (!hasEvidence(scrub.block.text, l.text)) {
        drop(what, l.text, "not word for word in its lines", scrub.block.id);
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
    rank: number;
    key: string;
    label: string;
    scrub: EntryScrub;
  };

  // ----- projects -----
  const projects: Kept<ProjectSuggestion>[] = [];
  const projectItems = steps.projects?.projects ?? [];
  const projectBlocks = blocksFor(
    projectItems.map((p) => ({ lines: p.lines, title: p.title })),
    ctx.projectLines,
    "project",
    drop,
  );
  projectItems.forEach((p, i) => {
    const placed = projectBlocks[i];
    if (!placed) return;
    const { block, rank } = placed;
    const rawTitle = tidy(stripMarker(p.title));
    if (!inBlock(block, rawTitle)) {
      drop("project", p.title, "title not in its lines", block.id);
      return;
    }
    const scrub = new EntryScrub(block);
    scrub.addNames(p.clientNames ?? []);
    scrub.addLineNames(p.outcomes);
    const { links, year } = block;
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
      rank,
      key: norm(rawTitle),
      label: p.title,
      scrub,
    });
  });

  // ----- experience -----
  const roles: Kept<ExperienceSuggestion>[] = [];
  const roleItems = steps.experience?.experience ?? [];
  const roleBlocks = blocksFor(
    roleItems.map((r) => ({ lines: r.lines, title: r.title })),
    ctx.experienceLines,
    "role",
    drop,
  );
  roleItems.forEach((r, i) => {
    const placed = roleBlocks[i];
    if (!placed) return;
    const { block, rank } = placed;
    const rawTitle = tidy(stripMarker(r.title));
    if (!inBlock(block, rawTitle)) {
      drop("role", r.title, "title not in its lines", block.id);
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
      drop("organisation", modelOrg, "not in its lines", block.id);
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

    const ownRange = block.range;
    const value = experienceSuggestion.safeParse({
      title: fit(scrub.apply(rawTitle), WORK_LIMITS.entryTitle),
      organisation: orgFree
        ? null
        : organisation && fit(organisation, WORK_LIMITS.organisation),
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
      rank,
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
    what: "project" | "role",
    max: number,
  ): T[] => {
    // Resume order (each entry's first line); the sort is stable for equal ranks.
    list.sort((a, b) => a.rank - b.rank);
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
    projects: finish(projects, "project", WORK_LIMITS.projects),
    experience: finish(roles, "role", WORK_LIMITS.roles),
  };
}
