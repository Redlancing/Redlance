import {
  CATEGORIES,
  RESUME_STEP_NAMES,
  SKILL_BY_ID,
  type ResumeStepName,
} from "@redlance/core";
import {
  createClient,
  createFakeTransport,
  type GenerateRequest,
  type LlmClient,
} from "@redlance/llm";
import { WORK_SHORTLIST_HEADING } from "../src/resume/steps/shared";
import {
  FULL_LIST_HEADING,
  SHORTLIST_HEADING,
} from "../src/resume/steps/skills";

// Test-only: a deterministic stand-in for Gemini so tests never call Vertex.
// Built only from the request. Nothing under src/ may import this file.

const CLOSE = "</resume>";

function parts(
  req: GenerateRequest<unknown>,
): { resume: string; task: string } | null {
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
 * (plus the next line when that's too short), cut to 160 characters around the match,
 * so it passes hasEvidence / hasSkillEvidence.
 */
function findWord(text: string, word: string): string | null {
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    let quote = lines[i]!;
    if (!substantial(quote) && lines[i + 1]) quote = `${quote} ${lines[i + 1]}`;
    if (quote.length > MAX_QUOTE) {
      const from = Math.max(
        0,
        Math.min(m.index - 40, quote.length - MAX_QUOTE),
      );
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
  const first =
    resume
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? null;
  return {
    displayName: first ? first.slice(0, 60) : null,
    headline: null,
    country: null,
  };
}

function jobTypes(resume: string) {
  for (const w of CODE_WORDS) {
    const hit = findWord(resume, w);
    if (hit)
      return {
        categories: [{ id: "development", evidence: hit }],
        experienceLevel: null,
      };
  }
  for (const c of CATEGORIES) {
    for (const word of c.hint.split(/,\s*/)) {
      const hit = word.length >= 3 ? findWord(resume, word) : null;
      if (hit)
        return {
          categories: [{ id: c.id, evidence: hit }],
          experienceLevel: null,
        };
    }
  }
  return { categories: [], experienceLevel: null };
}

function skills(resume: string, task: string) {
  const start = task.indexOf(SHORTLIST_HEADING);
  const end = task.indexOf(FULL_LIST_HEADING);
  const block =
    start >= 0
      ? task.slice(start + SHORTLIST_HEADING.length, end >= 0 ? end : undefined)
      : "";
  const out: { id: string; level: "core" | "secondary"; evidence: string }[] =
    [];
  for (const line of block.split("\n")) {
    const id = /^(\S+) — /.exec(line.trim())?.[1];
    const skill = id ? SKILL_BY_ID.get(id) : undefined;
    if (!skill) continue;
    for (const label of [skill.name, ...skill.aliases]) {
      const hit = label.length >= 3 ? findWord(resume, label) : null;
      if (hit) {
        out.push({
          id: skill.id,
          level: out.length < 3 ? "core" : "secondary",
          evidence: hit,
        });
        break;
      }
    }
    if (out.length >= 30) break;
  }
  return { skills: out, customSkills: [] };
}

// ---------- projects and experience ----------

/** The "[P1]" / "[E1]" blocks the work steps put inside <resume>. */
function blocksOf(resume: string): { id: string; lines: string[] }[] {
  const out: { id: string; lines: string[] }[] = [];
  for (const raw of resume.split("\n")) {
    const id = /^\[([PE]\d+)\]$/.exec(raw.trim())?.[1];
    if (id) out.push({ id, lines: [] });
    else if (out.length && raw.trim()) out.at(-1)!.lines.push(raw.trim());
  }
  return out;
}

/** The shortlist ids the work steps list under their heading (up to the first blank line). */
function workShortlist(task: string): string[] {
  const start = task.indexOf(WORK_SHORTLIST_HEADING);
  if (start < 0) return [];
  const ids: string[] = [];
  for (const line of task
    .slice(start + WORK_SHORTLIST_HEADING.length)
    .split("\n")
    .slice(1)) {
    if (!line.trim()) break;
    const id = /^(\S+) — /.exec(line.trim())?.[1];
    if (id && SKILL_BY_ID.has(id)) ids.push(id);
  }
  return ids;
}

const BULLET = /^(?:[-–—•*▪◦●]|\d{1,2}[.)])\s*/;
const SEPARATORS = [
  " — ",
  " – ",
  " - ",
  " | ",
  " · ",
  ", ",
  " at ",
  " (",
  "\t",
];

/** The first line split at its first separator: [title, rest]. */
function headParts(first: string): [string, string] {
  let at = -1;
  let len = 0;
  for (const sep of SEPARATORS) {
    const i = first.indexOf(sep);
    if (i > 0 && (at < 0 || i < at)) [at, len] = [i, sep.length];
  }
  return at < 0
    ? [first, ""]
    : [first.slice(0, at).trim(), first.slice(at + len).trim()];
}

/** A capitalised name after "for " ("for Acme Realty's site" → "Acme Realty"), else none (lines and titles). */
function clientNamesIn(text: string) {
  const m =
    /\bfor ((?:[A-Z][\p{L}\p{N}&-]*)(?:\s+[A-Z][\p{L}\p{N}&-]*){0,2})/u.exec(
      text,
    );
  return m ? [{ name: m[1]!, generic: "a client" }] : [];
}

/** Bullet lines (and long body lines) after the head, as copied lines; names on the first. */
function copiedLines(lines: string[], max: number) {
  return lines
    .slice(1)
    .filter((l) => BULLET.test(l) || l.length > 120)
    .slice(0, max)
    .map((l, i) => {
      const text = l.replace(BULLET, "").slice(0, MAX_QUOTE).trim();
      return { text, clientNames: i === 0 ? clientNamesIn(text) : [] };
    });
}

function blockSkills(text: string, shortlist: string[]): string[] {
  return shortlist
    .filter((id) => {
      const s = SKILL_BY_ID.get(id)!;
      return [s.name, ...s.aliases].some(
        (label) => label.length >= 3 && findWord(text, label) !== null,
      );
    })
    .slice(0, 10);
}

function projects(resume: string, task: string) {
  const shortlist = workShortlist(task);
  return {
    projects: blocksOf(resume)
      .slice(0, 8)
      .map((b) => {
        const text = b.lines.join("\n");
        const title = headParts(b.lines[0] ?? "")[0].slice(0, 80);
        return {
          block: b.id,
          title,
          summary: "A project listed on the resume.",
          role: "unknown",
          kind: "unknown",
          skills: blockSkills(text, shortlist),
          categories: CODE_WORDS.some((w) => findWord(text, w))
            ? ["development"]
            : [],
          domains: [],
          outcomes: copiedLines(b.lines, 3),
          clientNames: clientNamesIn(title),
        };
      }),
  };
}

function experience(resume: string, task: string) {
  const shortlist = workShortlist(task);
  return {
    experience: blocksOf(resume)
      .slice(0, 6)
      .map((b) => {
        const text = b.lines.join("\n");
        const [title, rest] = headParts(b.lines[0] ?? "");
        const org = headParts(rest)[0];
        const employmentType = /freelance/i.test(text)
          ? "freelance"
          : /contract/i.test(text)
            ? "contract"
            : /intern/i.test(text)
              ? "internship"
              : "unknown";
        return {
          block: b.id,
          title: title.slice(0, 80),
          // A head segment without digits (not a date) is read as the organisation.
          organisation: org && !/\d/.test(org) ? org.slice(0, 80) : null,
          organisationDescription:
            employmentType === "freelance" ? "a client" : "a company",
          employmentType,
          summary: "A role listed on the resume.",
          highlights: copiedLines(b.lines, 4),
          skills: blockSkills(text, shortlist),
          categories: [],
          domains: [],
          clientNames: clientNamesIn(title),
        };
      }),
  };
}

/** Deterministic, schema-valid answers for the resume steps. */
export function stubResumeResponder(req: GenerateRequest<unknown>): unknown {
  const p = parts(req);
  switch (stepOf(req)) {
    case "basics":
      return basics(p!.resume);
    case "jobTypes":
      return jobTypes(p!.resume);
    case "skills":
      return skills(p!.resume, p!.task);
    case "projects":
      return projects(p!.resume, p!.task);
    case "experience":
      return experience(p!.resume, p!.task);
    default:
      return {};
  }
}

// ---------- match re-score ----------

/** The text between `<tag>\n` and `\n</tag>` in the prompt, or "". */
function block(prompt: string, tag: string): string {
  const open = prompt.indexOf(`<${tag}>\n`);
  const close = prompt.indexOf(`\n</${tag}>`);
  return open >= 0 && close > open
    ? prompt.slice(open + tag.length + 3, close)
    : "";
}

export const isRescoreRequest = (req: GenerateRequest<unknown>) =>
  /^Task: match_rescore$/m.test(req.prompt);

/**
 * Deterministic re-score: 85 when the post's title or body names one of the profile's core
 * skills, otherwise 40; the first project (and role) when there is one, with a reason naming it.
 */
export function stubRescoreResponder(req: GenerateRequest<unknown>): unknown {
  const post = block(req.prompt, "post");
  // Title and body only: the lines before our own "Analysis:" line.
  const text = post.slice(0, post.lastIndexOf("\nAnalysis: ")).toLowerCase();
  const profile = block(req.prompt, "profile");
  const core = (/^Core skills: (.*)$/m.exec(profile)?.[1] ?? "none")
    .split(", ")
    .filter((s) => s !== "none");
  const project = /^\[P1\] (.*?): /m.exec(profile)?.[1];
  const hit = core.some((s) => text.includes(s.toLowerCase()));
  return {
    score: hit ? 85 : 40,
    reason: project ? `You built ${project}.` : "Your skills partly fit.",
    bestProject: project ? "P1" : null,
    bestRole: /^\[E1\] /m.test(profile) ? "E1" : null,
    concerns: hit ? [] : ["Core skills not named"],
  };
}

/** An LlmClient that answers resume steps and match re-scores with the stub (no network). */
export function stubLlm(): LlmClient {
  return createClient(
    createFakeTransport((req) =>
      isRescoreRequest(req)
        ? stubRescoreResponder(req)
        : stubResumeResponder(req),
    ),
  );
}
