import {
  CATEGORIES,
  RESUME_STEP_NAMES,
  SKILL_BY_ID,
  type ResumeStepName,
} from "@redlance/core";
import type { GenerateRequest } from "@redlance/llm";
import { FULL_LIST_HEADING, SHORTLIST_HEADING } from "./resume/steps/skills";

// Deterministic answers for LLM_MODE=fake (local dev without Google credentials) and tests.
// Built only from the request: never reads anything else.

const CLOSE = "</resume>";

function parts(req: GenerateRequest<unknown>): { resume: string; task: string } | null {
  const open = req.prompt.indexOf("<resume>\n");
  const close = req.prompt.lastIndexOf(CLOSE);
  if (open !== 0 || close < 0) return null;
  return {
    resume: req.prompt.slice("<resume>\n".length, close).trim(),
    task: req.prompt.slice(close + CLOSE.length),
  };
}

/** Which resume step a request is for, from the `Task: <name>` marker after the resume. */
export function stepOf(req: GenerateRequest<unknown>): ResumeStepName | null {
  const p = parts(req);
  if (!p) return null;
  const m = /^Task: (\w+)$/m.exec(p.task);
  const name = m?.[1] as ResumeStepName | undefined;
  return name && RESUME_STEP_NAMES.includes(name) ? name : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MAX_QUOTE = 160;
const substantial = (q: string) => q.length >= 12 || q.split(/\s+/).length >= 2;

/**
 * Evidence for the first whole-word match of `word`: the trimmed line containing it
 * (plus the next line when that's too short), cut to 160 characters around the match.
 */
function findWord(text: string, word: string): string | null {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    let quote = lines[i]!;
    if (!substantial(quote) && lines[i + 1]) quote = `${quote} ${lines[i + 1]}`;
    if (quote.length > MAX_QUOTE) {
      const from = Math.max(0, Math.min(m.index - 40, quote.length - MAX_QUOTE));
      quote = quote.slice(from, from + MAX_QUOTE).trim();
    }
    return quote;
  }
  return null;
}

const CODE_WORDS = [
  "developer",
  "software",
  "programming",
  "programmer",
  "code",
  "coding",
  "javascript",
  "typescript",
  "python",
  "react",
];

function basics(resume: string) {
  const first = resume.split("\n").find((l) => l.trim())?.trim() ?? null;
  return { displayName: first ? first.slice(0, 60) : null, headline: null, country: null };
}

function jobTypes(resume: string) {
  for (const w of CODE_WORDS) {
    const hit = findWord(resume, w);
    if (hit) return { categories: [{ id: "development", evidence: hit }], experienceLevel: null };
  }
  for (const c of CATEGORIES) {
    for (const word of c.hint.split(/,\s*/)) {
      const hit = word.length >= 3 ? findWord(resume, word) : null;
      if (hit) return { categories: [{ id: c.id, evidence: hit }], experienceLevel: null };
    }
  }
  return { categories: [], experienceLevel: null };
}

function skills(resume: string, task: string) {
  const start = task.indexOf(SHORTLIST_HEADING);
  const end = task.indexOf(FULL_LIST_HEADING);
  const block = start >= 0 ? task.slice(start + SHORTLIST_HEADING.length, end >= 0 ? end : undefined) : "";
  const out: { id: string; level: "core" | "secondary"; evidence: string }[] = [];
  for (const line of block.split("\n")) {
    const id = /^(\S+) — /.exec(line.trim())?.[1];
    const skill = id ? SKILL_BY_ID.get(id) : undefined;
    if (!skill) continue;
    for (const label of [skill.name, ...skill.aliases]) {
      const hit = label.length >= 3 ? findWord(resume, label) : null;
      if (hit) {
        out.push({ id: skill.id, level: out.length < 3 ? "core" : "secondary", evidence: hit });
        break;
      }
    }
    if (out.length >= 30) break;
  }
  return { skills: out, customSkills: [] };
}

export function fakeResumeResponder(req: GenerateRequest<unknown>): unknown {
  const p = parts(req);
  switch (stepOf(req)) {
    case "basics":
      return basics(p!.resume);
    case "jobTypes":
      return jobTypes(p!.resume);
    case "skills":
      return skills(p!.resume, p!.task);
    default:
      return {};
  }
}
