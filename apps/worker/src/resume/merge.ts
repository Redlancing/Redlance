import {
  LIMITS,
  SKILL_BY_ID,
  findSkill,
  isCountryCode,
  isUsableSkillName,
  normalizeSkillName,
  suggestionsSchema,
  type ResumeStepName,
  type Suggestions,
} from "@redlance/core";
import { hasEvidence, hasSkillEvidence } from "./evidence";
import { skillLabelOccurs } from "./prepass";
import type { ResumeSections } from "./sections";
import type { BasicsOutput, JobTypesOutput, SkillsOutput } from "./step-types";

type Level = "core" | "secondary";

/** Something a step suggested that the merge left out, and why (for the dev console). */
export type DroppedItem = {
  what:
    | "displayName"
    | "headline"
    | "country"
    | "category"
    | "skill"
    | "customSkill";
  value: string;
  reason: string;
};

// Links in a suggested name or headline would be shown (and saved) as the
// user's own words, so they're removed. Scheme/www links match in any case;
// a bare "domain.tld/path" only in lowercase with a common TLD, so tech names
// like "Node.js/React" or "ASP.NET/C#" survive.
const SCHEME_LINK_RE = /(?:https?:\/\/|www\.)\S*/gi;
const TLDS =
  "com|net|org|io|dev|app|ai|co|me|xyz|in|uk|gg|tv|ly|so|sh|to|be|de|site|page|link|bio";
const PATH_LINK_RE = new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\/\\S*`, "g");
const BARE_DOMAIN_RE = new RegExp(`\\b[a-z0-9-]+\\.(?:${TLDS})\\b`, "i");

function stripLinks(value: string): string {
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
  },
  ctx: {
    text: string;
    sections: ResumeSections;
    shortlist: string[];
    yearsExperience: number | null;
    githubUsername: string | null;
    pipelineVersion: string;
    promptVersions: Record<ResumeStepName, string>;
    partial: ResumeStepName[];
    /** When given, collects what was left out and why. */
    dropped?: DroppedItem[];
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

  return suggestionsSchema.parse({
    v: 1,
    meta: {
      pipelineVersion: ctx.pipelineVersion,
      promptVersions: ctx.promptVersions,
      partial: ctx.partial,
    },
    basics,
    skills: skillList,
    customSkills: customList,
    githubUsername: ctx.githubUsername,
  });
}
