import { CATEGORIES } from "@redlance/core";
import { jobTypesOutput, type JobTypesOutput } from "../step-types";
import {
  resumePrompt,
  routeText,
  SYSTEM,
  taskMarker,
  type StepSpec,
} from "./shared";

const CATEGORY_LINES = CATEGORIES.map(
  (c) => `${c.id} — ${c.name}: ${c.hint}`,
).join("\n");

export const jobTypesStep: StepSpec<JobTypesOutput> = {
  name: "jobTypes",
  version: "jobTypes@1",
  model: "fast",
  maxOutputTokens: 400,
  thinking: "off",
  schema: jobTypesOutput,
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      routeText(input, ["summary", "experience", "projects"]),
      [
        taskMarker("jobTypes"),
        "Freelance job types (id — name: examples):",
        CATEGORY_LINES,
        "",
        "- categories: pick 1 to 3 job types this person is qualified to be hired for, by id. " +
          "For each, give evidence: a short quote (at most 160 characters) copied word for word from the resume. " +
          "Use an empty list if none fit.",
        "- experienceLevel: less than 1 year of paid work → beginner; 1 to 3 years → intermediate; more than 3 years → experienced; null if you can't tell.",
        `Years of paid experience computed from dates: ${input.yearsExperience ?? "unknown"}`,
      ].join("\n"),
    ),
};
