import { basicsOutput, type BasicsOutput } from "../step-types";
import { resumePrompt, routeText, SYSTEM, taskMarker, type StepSpec } from "./shared";

export const basicsStep: StepSpec<BasicsOutput> = {
  name: "basics",
  version: "basics@1",
  model: "fast",
  maxOutputTokens: 300,
  thinking: "off",
  schema: basicsOutput,
  system: SYSTEM,
  buildPrompt: (input) =>
    resumePrompt(
      routeText(input, ["top", "summary"]),
      [
        taskMarker("basics"),
        "From the resume above, extract:",
        "- displayName: the person's name as they would sign a message (at most 60 characters), or null.",
        "- headline: a headline of at most 120 characters in their own words (for example the title line under their name), or null.",
        "- country: their country as an ISO 3166 alpha-2 code (for example GB, US, IN), only if it is stated or clearly implied by a location line; otherwise null.",
      ].join("\n"),
    ),
};
