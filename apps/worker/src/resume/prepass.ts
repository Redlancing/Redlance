import {
  SKILLS,
  checkGithubInput,
  normalizeSkillName,
  type Skill,
} from "@redlance/core";
import type { ResumeSections } from "./sections";

export const MAX_SHORTLIST = 60;

export function githubFromText(text: string): string | null {
  for (const m of text.matchAll(
    /(?<![a-z0-9.-])github\.com\/[^\s"'<>()\[\],;]+/gi,
  )) {
    const check = checkGithubInput(m[0].replace(/[.,:;!?|]+$/, ""));
    if (check.ok && check.username) return check.username;
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Matcher = { skill: Skill; label: string; re: RegExp; short: boolean };

/**
 * Whole-word match. After: not a letter/digit/+/#. Labels of 2 chars or fewer are stricter so
 * "C-suite", "go-to-market" and "R&D" don't match: no letter/digit/&/- before, and no "-letter" or
 * "&" after. For longer labels "-" is a normal boundary ("React-based", "Ruby-on-Rails").
 */
const wordRe = (label: string) => {
  const short = label.length <= 2;
  return new RegExp(
    `(?<![a-z0-9${short ? "&\\-" : ""}])${escapeRe(label)}(?![a-z0-9+#]${short ? "|-[a-z]|&" : ""})`,
    "u",
  );
};

/** True if `label` (already normalised) occurs as a whole word/phrase in `text`. */
export function containsLabel(text: string, label: string): boolean {
  return wordRe(label).test(text.normalize("NFKC").toLowerCase());
}

const BY_SKILL = new Map<Skill, Matcher[]>(
  SKILLS.filter((s) => !s.retired).map((skill) => [
    skill,
    [...new Set([skill.name, ...skill.aliases].map(normalizeSkillName))]
      .filter(Boolean)
      .map((label) => ({
        skill,
        label,
        re: wordRe(label),
        short: label.length <= 2,
      })),
  ]),
);

/** True if any label of the skill appears as a whole word/phrase in `text`. */
export function skillLabelOccurs(skill: Skill, text: string): boolean {
  const hay = text.normalize("NFKC").toLowerCase();
  return (BY_SKILL.get(skill) ?? []).some((m) => m.re.test(hay));
}

export function skillShortlist(
  text: string,
  sections: ResumeSections,
): string[] {
  const full = text.normalize("NFKC").toLowerCase();
  const skillsSection = sections.skills.normalize("NFKC").toLowerCase();
  const offset = Math.max(0, full.indexOf(skillsSection));
  const found: { id: string; pos: number }[] = [];

  for (const [skill, matchers] of BY_SKILL) {
    let best = -1;
    for (const m of matchers) {
      const i = (m.short ? skillsSection : full).search(m.re);
      if (i < 0) continue;
      const pos = m.short ? offset + i : i;
      if (best < 0 || pos < best) best = pos;
    }
    if (best >= 0) found.push({ id: skill.id, pos: best });
  }
  return found
    .sort((a, b) => a.pos - b.pos)
    .slice(0, MAX_SHORTLIST)
    .map((f) => f.id);
}
