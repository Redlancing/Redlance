import { mergeSuggestions, type ResumeStepName } from "@redlance/core";
import type { ImportSummary } from "@/server/onboarding/imports";

export type ImportView = {
  busy: boolean;
  message: string | null;
  tone: "info" | "success" | "warning" | "error";
  stage: string | null;
};

const GENERIC =
  "Something went wrong reading your resume. Try again, or fill in the steps yourself.";
const GITHUB_DOWN = "GitHub isn't answering right now. Try again in a minute.";

const ERROR_MESSAGES: Record<string, string> = {
  NO_TEXT:
    "We couldn't read text from this file. If it's a scanned image, add your details by hand.",
  UNSUPPORTED_FILE: "That file isn't a readable PDF or Word document.",
  LLM_BUSY:
    "Resume import is busy right now. Fill in the steps yourself or try again later.",
  LLM_FAILED: GENERIC,
  INTERNAL: GENERIC,
  TIMEOUT: GENERIC,
  GITHUB_NOT_FOUND: "We couldn't find that GitHub account.",
  GITHUB_RATE_LIMITED: GITHUB_DOWN,
  GITHUB_UNAVAILABLE: GITHUB_DOWN,
  // HTTP statuses from starting an import.
  "413": "That file is over 5 MB.",
  "415": "Upload a PDF or Word (.docx) file.",
  "429": "You've reached today's import limit.",
  // Error codes from starting an import.
  QUOTA_EXCEEDED: "You've reached today's import limit.",
  RATE_LIMITED: "Too many requests — try again in a moment.",
  PAYLOAD_TOO_LARGE: "That file is over 5 MB.",
};

/** A job's error code (or an HTTP status as a string) → a plain sentence for the user. */
export function importErrorMessage(code: string | null): string {
  return (code && ERROR_MESSAGES[code]) || GENERIC;
}

/** The sentence for a refused start (upload or GitHub): by error code first, then status. */
export function startErrorMessage(
  status: number,
  code: string | null,
  message: string,
): string {
  if (
    code === "QUOTA_EXCEEDED" ||
    code === "RATE_LIMITED" ||
    code === "PAYLOAD_TOO_LARGE"
  )
    return importErrorMessage(code);
  if (code === "UNSUPPORTED_FILE" || status === 415)
    return importErrorMessage("415");
  if (status === 413 || status === 429)
    return importErrorMessage(String(status));
  return message;
}

const RUNNING_STAGE: Record<string, string> = {
  queued: "Getting ready…",
  reading: "Reading your resume…",
  analysing: "Finding your details…",
  checking: "Checking results…",
};

const PARTIAL_HINT: Record<ResumeStepName, string> = {
  basics: "your basics in Basics",
  jobTypes: "your job types in Basics",
  skills: "your skills in Skills",
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const isActive = (j: ImportSummary) =>
  j.status === "queued" || j.status === "running";

export function describeImports(
  jobs: ImportSummary[],
  uploading: number | null,
): ImportView {
  if (uploading !== null)
    return {
      busy: true,
      message: `Uploading ${Math.round(uploading)}%…`,
      tone: "info",
      stage: "uploading",
    };

  const active = jobs.filter(isActive);
  if (active.length) {
    const job = active.find((j) => j.kind === "resume") ?? active[0]!;
    const message =
      job.kind === "github"
        ? "Reading your GitHub…"
        : (RUNNING_STAGE[job.stage] ?? "Reading your resume…");
    return { busy: true, message, tone: "info", stage: job.stage };
  }

  if (!jobs.length)
    return { busy: false, message: null, tone: "info", stage: null };

  const done = jobs.filter((j) => j.status === "done");
  const failed = jobs.filter((j) => j.status === "failed");
  const failures = failed.map((j) => importErrorMessage(j.errorCode));
  if (!done.length)
    return {
      busy: false,
      message: [...new Set(failures)].join(" "),
      tone: "error",
      stage: "failed",
    };

  // A done import with no suggestions found nothing; that's not a failure.
  const merged = mergeSuggestions(
    done.flatMap((j) =>
      j.suggestions ? [{ source: j.kind, suggestions: j.suggestions }] : [],
    ),
  );
  const b = merged.basics;
  const filled: string[] = [];
  if (b.displayName || b.headline || b.experienceLevel || b.country)
    filled.push("your basics");
  if (b.categories?.length)
    filled.push(plural(b.categories.length, "job type", "job types"));
  const skillCount = merged.skills.length + merged.customSkills.length;
  if (skillCount) filled.push(plural(skillCount, "skill", "skills"));

  const partial = [...new Set(done.flatMap((j) => j.partial))];
  const sentences: string[] = [];
  if (!filled.length)
    sentences.push(
      "We couldn't find anything to fill in from that. Add your details by hand on the next steps.",
    );
  else if (partial.length)
    sentences.push(
      `We filled in ${joinAnd(filled)}, but not everything. Please add ${joinAnd(partial.map((p) => PARTIAL_HINT[p]))} by hand.`,
    );
  else
    sentences.push(
      `Done — we filled in ${joinAnd(filled)}. Check them on the next steps.`,
    );
  sentences.push(...failures);

  return {
    busy: false,
    message: sentences.join(" "),
    tone:
      filled.length && !partial.length && !failures.length
        ? "success"
        : "warning",
    stage: "done",
  };
}

/** What the live region reads out: stage changes only (the progress bar carries the %). */
export function liveAnnouncement(view: ImportView): string | null {
  return view.stage === "uploading" ? "Uploading your resume…" : view.message;
}

/**
 * Adds imports that are queued/running but not tracked yet (e.g. a GitHub import the worker
 * started from a link in the resume), replacing an older job of the same kind.
 * Returns null when there is nothing new to follow.
 */
export function adoptImports(
  tracked: ImportSummary[],
  incoming: ImportSummary[],
): ImportSummary[] | null {
  const ids = new Set(tracked.map((j) => j.id));
  const fresh = incoming.filter((j) => isActive(j) && !ids.has(j.id));
  if (!fresh.length) return null;
  const kinds = new Set(fresh.map((j) => j.kind));
  return [...tracked.filter((j) => !kinds.has(j.kind)), ...fresh];
}

export { isActive as isActiveImport };
