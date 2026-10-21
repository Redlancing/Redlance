import { SKILLS } from "@redlance/core";
import { skillsOutput, type SkillsOutput } from "../step-types";
import {
  resumePrompt,
  routeText,
  shortlistText,
  SYSTEM,
  taskMarker,
  type CallSpec,
} from "./shared";

export const FULL_LIST_HEADING = "You may use any id from this full list:";

const ALL_IDS = SKILLS.filter((s) => !s.retired)
  .map((s) => s.id)
  .join(", ");

export const skillsCall: CallSpec<SkillsOutput> = {
  name: "skills",
  // skills@3: Flash-Lite (was Flash), fixed text first and the resume last.
  version: "skills@3",
  model: "fast",
  maxOutputTokens: 1500,
  thinking: "off",
  parts: ["skills"],
  schema: skillsOutput,
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      [
        taskMarker("skills"),
        "- skills: the skills the resume below shows this person can do for clients, by id. " +
          "level is core for their main paid work (at most 8 core) and secondary otherwise. " +
          "For each, give evidence: a short quote (at most 160 characters) copied word for word from the resume. " +
          "Use only ids from the two lists below; leave out skills that aren't in them.",
        "",
        `${FULL_LIST_HEADING} ${ALL_IDS}`,
        "",
        shortlistText(input.shortlist),
      ].join("\n"),
      routeText(input, ["skills", "experience", "projects"]),
    ),
  split: (skills) => ({ skills }),
};
