import { CATEGORIES, SKILL_BY_ID } from "@redlance/core";
import {
  createClient,
  createFakeTransport,
  type GenerateRequest,
  type LlmClient,
} from "@redlance/llm";
import {
  SHORTLIST_HEADING,
  type ResumeCallName,
} from "../src/resume/steps/shared";

// Test-only: a deterministic stand-in for Gemini so tests never call Vertex.
// Built only from the request. Nothing under src/ may import this file.

const OPEN = "\n\n<resume>\n";
const CLOSE = "\n</resume>";
const CALL_NAMES: readonly ResumeCallName[] = ["profile", "skills", "work"];

/** A resume prompt's task (before the resume) and resume (last, up to the closing tag). */
function parts(
  req: GenerateRequest<unknown>,
): { resume: string; task: string } | null {
  const open = req.prompt.indexOf(OPEN);
  if (open < 0 || !req.prompt.endsWith(CLOSE)) return null;
  return {
    task: req.prompt.slice(0, open),
    resume: req.prompt.slice(open + OPEN.length, -CLOSE.length).trim(),
  };
}

/** Which resume call a request is for, from the `Task: <name>` marker before the resume. */
export function callOf(req: GenerateRequest<unknown>): ResumeCallName | null {
  const p = parts(req);
  if (!p) return null;
  const m = /^Task: (\w+)$/m.exec(p.task);
  const name = m?.[1] as ResumeCallName | undefined;
  return name && CALL_NAMES.includes(name) ? name : null;
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
  const out: { id: string; level: "core" | "secondary"; evidence: string }[] =
    [];
  for (const id of shortlistOf(task)) {
    const skill = SKILL_BY_ID.get(id)!;
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
  return { skills: out };
}

// ---------- projects and experience ----------

/** The text inside `<tag>` … `</tag>` in the work call's resume, or null. */
function section(resume: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(resume);
  return m ? m[1]! : null;
}

/**
 * The work call numbers every line ("[P3] …", "[E3] …") inside <projects> and
 * <experience>; the stub groups them into entries the simple way: a new entry starts at a
 * line that isn't a bullet when a blank line or a bullet came before it.
 */
function blocksOf(
  text: string,
): { from: number; to: number; lines: string[] }[] {
  const out: { from: number; to: number; lines: string[] }[] = [];
  let gap = true;
  let afterBullet = false;
  for (const raw of text.split("\n")) {
    const m = /^\[[PE](\d+)\] (.*)$/.exec(raw);
    if (!m) {
      gap = true;
      continue;
    }
    const n = Number(m[1]);
    const line = m[2]!.trim();
    const bullet = BULLET.test(line);
    if (!out.length || (!bullet && (gap || afterBullet)))
      out.push({ from: n, to: n, lines: [] });
    const cur = out.at(-1)!;
    cur.to = n;
    cur.lines.push(line);
    gap = false;
    afterBullet = bullet || line.length > 120;
  }
  return out;
}

/** The shortlist ids the skills and work calls list under their heading (up to a blank line). */
function shortlistOf(task: string): string[] {
  const start = task.indexOf(SHORTLIST_HEADING);
  if (start < 0) return [];
  const ids: string[] = [];
  for (const line of task
    .slice(start + SHORTLIST_HEADING.length)
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

function projects(text: string, shortlist: string[]) {
  return {
    projects: blocksOf(text)
      .slice(0, 8)
      .map((b) => {
        const text = b.lines.join("\n");
        const title = headParts(b.lines[0] ?? "")[0].slice(0, 80);
        return {
          lines: { from: b.from, to: b.to },
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

function experience(text: string, shortlist: string[]) {
  return {
    experience: blocksOf(text)
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
          lines: { from: b.from, to: b.to },
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

/** The work call: a list for each labelled part of the resume it was given. */
function work(resume: string, task: string) {
  const shortlist = shortlistOf(task);
  const p = section(resume, "projects");
  const e = section(resume, "experience");
  return {
    ...(p !== null && projects(p, shortlist)),
    ...(e !== null && experience(e, shortlist)),
  };
}

/** Deterministic, schema-valid answers for the resume calls. */
export function stubResumeResponder(req: GenerateRequest<unknown>): unknown {
  const p = parts(req);
  switch (callOf(req)) {
    case "profile":
      return { ...basics(p!.resume), ...jobTypes(p!.resume) };
    case "skills":
      return skills(p!.resume, p!.task);
    case "work":
      return work(p!.resume, p!.task);
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

// ---------- drafts ----------

export const isDraftRequest = (req: GenerateRequest<unknown>) =>
  /^Task: draft$/m.test(req.prompt);

/** In a post: the first answer invents "60%"; the retry (with <problems>) is clean. */
export const STUB_INVENT = "STUB_INVENT";
/** In a post: every answer invents "60%", so the validator fails twice. */
export const STUB_INVENT_TWICE = "STUB_INVENT_TWICE";

/**
 * Deterministic draft: a 2-sentence comment and an ~80-word DM built from the evidence's
 * project, first skill and link, so it passes the validators. `STUB_INVENT` in the prompt
 * adds an invented "60%" (first answer only); `STUB_INVENT_TWICE` adds it every time.
 */
export function stubDraftResponder(req: GenerateRequest<unknown>): unknown {
  const ev = block(req.prompt, "evidence");
  const project = /^Project: (.*?)(?: \(\d{4}\))?$/m.exec(ev)?.[1];
  const skill =
    (/^Skills to mention: (.*)$/m.exec(ev)?.[1] ?? "none").split(", ")[0] ??
    "none";
  const link = /^Link: (\S+)$/m.exec(ev)?.[1];
  const work = project && project !== "none" ? project : "a similar project";
  const tool = skill !== "none" ? skill : "the right tools";
  const retry = req.prompt.includes("<problems>");
  const invent =
    req.prompt.includes(STUB_INVENT_TWICE) ||
    (req.prompt.includes(STUB_INVENT) && !retry);
  const dm = [
    "Hi, it sounds like you need this sorted without a lot of back and forth.",
    `I recently built ${work} with ${tool}${link ? `, and you can see it here: ${link}` : ""}.`,
    invent ? "It made pages load 60% faster." : "It was a close fit for this.",
    "I would start by looking at what you have now, fix the main problem first, and keep you posted as I go so nothing is a surprise.",
    "I can share a short plan once I know a bit more about the scope.",
    "Would a quick chat this week work for you?",
  ].join(" ");
  return {
    problem: "They need the job done well and quickly.",
    citedFact: `Built ${work}`,
    applyInstructions: null,
    comment: `I built ${work} with ${tool}. Sent you a DM.`,
    dm,
  };
}

// ---------- voice notes ----------

export const isVoiceRequest = (req: GenerateRequest<unknown>) =>
  /^Task: voice$/m.test(req.prompt);

/**
 * Deterministic voice notes: plain instructions that end with the number of messages in the
 * prompt, so a test can tell two updates apart.
 */
export function stubVoiceResponder(req: GenerateRequest<unknown>): unknown {
  const count = (req.prompt.match(/^Message \d+ /gm) ?? []).length;
  return {
    notes: `Short sentences. Starts with hey. Never uses a sign-off. Based on ${count} messages.`,
  };
}

/** An LlmClient that answers resume steps, match re-scores, drafts and voice notes with the stub (no network). */
export function stubLlm(): LlmClient {
  return createClient(
    createFakeTransport((req) =>
      isDraftRequest(req)
        ? stubDraftResponder(req)
        : isVoiceRequest(req)
          ? stubVoiceResponder(req)
          : isRescoreRequest(req)
            ? stubRescoreResponder(req)
            : stubResumeResponder(req),
    ),
  );
}
