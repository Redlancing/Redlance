import { CATEGORIES } from "@redlance/core";
import { profileOutput, type ProfileOutput } from "../step-types";
import {
  resumePrompt,
  routeText,
  SYSTEM,
  taskMarker,
  type CallSpec,
} from "./shared";

const CATEGORY_LINES = CATEGORIES.map(
  (c) => `${c.id} — ${c.name}: ${c.hint}`,
).join("\n");

/** Basics and job types in one call (they were two calls until profile@1). */
export const profileCall: CallSpec<ProfileOutput> = {
  name: "profile",
  version: "profile@1",
  model: "fast",
  // The two old calls' budgets added up (basics 300 + job types 400).
  maxOutputTokens: 700,
  thinking: "off",
  parts: ["basics", "jobTypes"],
  schema: profileOutput,
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      [
        taskMarker("profile"),
        "From the resume below, extract:",
        "- displayName: the person's name as they would sign a message (at most 60 characters), or null.",
        "- headline: a headline of at most 120 characters in their own words (for example the title line under their name), or null.",
        "- country: their country as an ISO 3166 alpha-2 code (for example GB, US, IN), only if it is stated or clearly implied by a location line; otherwise null.",
        "- categories: pick 1 to 3 job types this person is qualified to be hired for, by id. " +
          "For each, give evidence: a short quote (at most 160 characters) copied word for word from the resume. " +
          "Use an empty list if none fit.",
        "- experienceLevel: less than 1 year of paid work → beginner; 1 to 3 years → intermediate; more than 3 years → experienced; null if you can't tell.",
        "",
        "Freelance job types (id — name: examples):",
        CATEGORY_LINES,
        "",
        `Years of paid experience computed from dates: ${input.yearsExperience ?? "unknown"}`,
      ].join("\n"),
      // The union of what the two old calls read (basics: top and summary; job types:
      // summary, experience and projects), each section once.
      routeText(input, ["top", "summary", "experience", "projects"]),
    ),
  split: ({ displayName, headline, country, categories, experienceLevel }) => ({
    basics: { displayName, headline, country },
    jobTypes: { categories, experienceLevel },
  }),
};
