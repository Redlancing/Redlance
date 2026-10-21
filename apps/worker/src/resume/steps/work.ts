import type { ResumeStepName } from "@redlance/core";
import { workSchemaFor, type WorkOutput } from "../step-types";
import {
  resumePrompt,
  shortlistText,
  SYSTEM,
  taskMarker,
  type CallSpec,
  type PipelineInput,
  type ResumePart,
  type SkippedStep,
} from "./shared";
import {
  CLIENT_NAMES_RULE,
  ENTRY_NAMES_RULE,
  NEVER_INVENT,
  WORK_LISTS,
} from "./work-lists";

/** Why each work list doesn't run for this resume (an empty array: both run). */
function skipped(input: PipelineInput): SkippedStep[] {
  const out: SkippedStep[] = [];
  // Without a Projects heading, projects can't be told apart from jobs.
  if (!input.headed)
    out.push({ step: "projects", reason: "no section headings" });
  else if (!input.projectLines)
    out.push({ step: "projects", reason: "no Projects section" });
  if (!input.experienceLines)
    out.push({ step: "experience", reason: "no Experience section" });
  return out;
}

const runs = (input: PipelineInput, step: ResumeStepName) =>
  !skipped(input).some((s) => s.step === step);

const PROJECT_RULES = [
  "projects: the projects in <projects>, at most 8, in resume order. For each:",
  "- lines: the number of its first line (from) and its last line (to): from 3, to 7 for [P3]…[P7]. All of its own lines, from its name to its last detail, and none of another project's.",
  "- title: the project's name, copied from its lines (at most 80 characters).",
  "- summary: one sentence in your own words on what it is (at most 160 characters). No client or company names, no links.",
  ENTRY_NAMES_RULE,
  "- role: solo, lead or team only if its lines say so.",
  "- kind: client, employer, personal, open_source, academic or hackathon.",
  "- skills: ids from the skills list below that its lines mention.",
  "- categories: up to 2 job type ids. domains: up to 4 domain ids for the field it served.",
  "- outcomes: up to 3 results, each copied word for word from its lines (at most 160 characters; copy part of a longer line).",
  CLIENT_NAMES_RULE,
].join("\n");

const EXPERIENCE_RULES = [
  "experience: the jobs in <experience>, at most 6, in resume order. For each:",
  "- lines: the number of its first line (from) and its last line (to): from 2, to 6 for [E2]…[E6]. All of the job's own lines (title, organisation, dates and every bullet), and none of another job's.",
  "- title: the job title, copied from its lines (at most 80 characters).",
  "- organisation: the employer or client name as its lines write it, or null.",
  '- organisationDescription: the organisation described without any word of its name, like "a fintech payments company" (at most 60 characters).',
  "- employmentType: full_time, part_time, freelance, contract or internship.",
  "- summary: one sentence in your own words on the job (at most 160 characters). No client or company names, no links.",
  ENTRY_NAMES_RULE,
  "- highlights: up to 4 things they did there, each copied word for word from its lines (at most 160 characters; copy part of a longer line). Projects done in this job go here.",
  CLIENT_NAMES_RULE,
  "- skills: ids from the skills list below that its lines mention.",
  "- categories: up to 2 job type ids. domains: up to 4 domain ids for the organisation's field.",
].join("\n");

/**
 * Projects and experience in one call (they were two calls until work@1). work@2: the
 * sections go in as numbered lines and the model says which lines each entry spans (code cut
 * them into blocks until work@1, and some layouts defeated it).
 */
export const workCall: CallSpec<WorkOutput> = {
  name: "work",
  version: "work@2",
  model: "fast",
  // The two old calls' budgets added up (2,000 each).
  maxOutputTokens: 4000,
  // Longer than the other calls: it writes up to two lists. 20 s still ends inside the
  // pipeline's 25 s deadline, but a retry after a timed-out first attempt gets only the
  // last ~5 s, so it usually ends as partial (projects and experience) rather than retried.
  timeoutMs: 20_000,
  thinking: "off",
  parts: ["projects", "experience"],
  skipParts: skipped,
  schemaFor: (input) =>
    workSchemaFor(
      runs(input, "projects") ? (input.projectLines?.lines.length ?? 0) : 0,
      runs(input, "experience")
        ? (input.experienceLines?.lines.length ?? 0)
        : 0,
      input.shortlist,
    ),
  system: SYSTEM,
  buildPrompt: (input) => {
    const projects = runs(input, "projects");
    const experience = runs(input, "experience");
    const where = [
      projects &&
        "<projects> holds the Projects section, its lines numbered [P1], [P2], …",
      experience &&
        "<experience> holds the work experience, its lines numbered [E1], [E2], …",
    ].filter(Boolean);
    const resume: ResumePart[] = [];
    if (projects && input.projectLines)
      resume.push({ tag: "projects", text: input.projectLines.text });
    if (experience && input.experienceLines)
      resume.push({ tag: "experience", text: input.experienceLines.text });
    return resumePrompt(
      [
        taskMarker("work"),
        WORK_LISTS,
        "",
        `In the resume below, ${where.join("; ")}. A number belongs to the line after it and is not part of the text: never copy it into a value.`,
        "",
        ...(projects ? [PROJECT_RULES, ""] : []),
        ...(experience ? [EXPERIENCE_RULES, ""] : []),
        NEVER_INVENT,
        "",
        shortlistText(input.shortlist),
      ].join("\n"),
      resume,
    );
  },
  split: (out) => ({
    ...(out.projects && { projects: { projects: out.projects } }),
    ...(out.experience && { experience: { experience: out.experience } }),
  }),
};
