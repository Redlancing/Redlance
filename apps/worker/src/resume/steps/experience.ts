import { experienceSchemaFor, type ExperienceOutput } from "../step-types";
import {
  blocksText,
  resumePrompt,
  SYSTEM,
  taskMarker,
  type StepSpec,
} from "./shared";
import {
  CLIENT_NAMES_RULE,
  ENTRY_NAMES_RULE,
  NEVER_INVENT,
  workLists,
} from "./work-lists";

export const experienceStep: StepSpec<ExperienceOutput> = {
  name: "experience",
  version: "experience@2",
  model: "fast",
  maxOutputTokens: 2000,
  timeoutMs: 14_000,
  thinking: "off",
  skip: (input) =>
    input.experienceBlocks.length === 0 ? "no Experience section" : null,
  schemaFor: (input) =>
    experienceSchemaFor(
      input.experienceBlocks.map((b) => b.id),
      input.shortlist,
    ),
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      blocksText(input.experienceBlocks),
      [
        taskMarker("experience"),
        "The resume above is the work experience, split into blocks that start with an id ([E1], [E2], …).",
        workLists(input.shortlist),
        "",
        "List the jobs, at most 6, in resume order. For each:",
        "- block: the id of the block it is in.",
        "- title: the job title, copied from the block (at most 80 characters).",
        "- organisation: the employer or client name as the block writes it, or null.",
        '- organisationDescription: the organisation described without any word of its name, like "a fintech payments company" (at most 60 characters).',
        "- employmentType: full_time, part_time, freelance, contract or internship.",
        "- summary: one sentence in your own words on the job (at most 160 characters). No client or company names, no links.",
        ENTRY_NAMES_RULE,
        "- highlights: up to 4 things they did there, each copied word for word from the block (at most 160 characters; copy part of a longer line). Projects done in this job go here.",
        CLIENT_NAMES_RULE,
        "- skills: ids from the skills list that the block mentions.",
        "- categories: up to 2 job type ids. domains: up to 4 domain ids for the organisation's field.",
        NEVER_INVENT,
      ].join("\n"),
    ),
};
