import { SKILL_BY_ID, SKILLS } from "@redlance/core";
import { skillsOutput, type SkillsOutput } from "../step-types";
import { resumePrompt, routeText, SYSTEM, taskMarker, type StepSpec } from "./shared";

export const SHORTLIST_HEADING = "Skills found in the text (id — name):";
export const FULL_LIST_HEADING = "You may also use any id from this full list:";

const ALL_IDS = SKILLS.filter((s) => !s.retired)
  .map((s) => s.id)
  .join(", ");

export const skillsStep: StepSpec<SkillsOutput> = {
  name: "skills",
  version: "skills@1",
  model: "smart",
  maxOutputTokens: 1500,
  thinking: "off",
  schema: skillsOutput,
  system: SYSTEM,
  buildPrompt: (input) => {
    const shortlist = input.shortlist
      .map((id) => SKILL_BY_ID.get(id))
      .filter((s) => s !== undefined)
      .map((s) => `${s.id} — ${s.name}`);
    return resumePrompt(
      routeText(input, ["skills", "experience", "projects"]),
      [
        taskMarker("skills"),
        SHORTLIST_HEADING,
        shortlist.length ? shortlist.join("\n") : "(none)",
        "",
        `${FULL_LIST_HEADING} ${ALL_IDS}`,
        "",
        "- skills: the skills the resume shows this person can do for clients, by id. " +
          "level is core for their main paid work (at most 8 core) and secondary otherwise. " +
          "For each, give evidence: a short quote (at most 160 characters) copied word for word from the resume.",
        "- customSkills: tools or skills the resume shows that aren't in the lists above, by name (at most 40 characters), " +
          "with level and a word-for-word evidence quote.",
      ].join("\n"),
    );
  },
};
