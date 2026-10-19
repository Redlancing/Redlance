import { projectsSchemaFor, type ProjectsOutput } from "../step-types";
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

export const projectsStep: StepSpec<ProjectsOutput> = {
  name: "projects",
  version: "projects@2",
  model: "fast",
  maxOutputTokens: 2000,
  timeoutMs: 14_000,
  thinking: "off",
  // Without a Projects heading, projects can't be told apart from jobs.
  skip: (input) =>
    !input.headed
      ? "no section headings"
      : input.projectBlocks.length === 0
        ? "no Projects section"
        : null,
  schemaFor: (input) =>
    projectsSchemaFor(
      input.projectBlocks.map((b) => b.id),
      input.shortlist,
    ),
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      blocksText(input.projectBlocks),
      [
        taskMarker("projects"),
        "The resume above is the Projects section, split into blocks that start with an id ([P1], [P2], …).",
        workLists(input.shortlist),
        "",
        "List the projects, at most 8, in resume order. For each:",
        "- block: the id of the block it is in.",
        "- title: the project's name, copied from the block (at most 80 characters).",
        "- summary: one sentence in your own words on what it is (at most 160 characters). No client or company names, no links.",
        ENTRY_NAMES_RULE,
        "- role: solo, lead or team only if the block says so.",
        "- kind: client, employer, personal, open_source, academic or hackathon.",
        "- skills: ids from the skills list that the block mentions.",
        "- categories: up to 2 job type ids. domains: up to 4 domain ids for the field it served.",
        "- outcomes: up to 3 results, each copied word for word from the block (at most 160 characters; copy part of a longer line).",
        CLIENT_NAMES_RULE,
        NEVER_INVENT,
      ].join("\n"),
    ),
};
