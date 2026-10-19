import { CATEGORY_IDS, DOMAIN_IDS, SKILL_BY_ID } from "@redlance/core";
import { WORK_SHORTLIST_HEADING } from "./shared";

/** The lists both work steps show the model: the shortlist, job types and domains. */
export function workLists(shortlist: string[]): string {
  const skills = shortlist
    .map((id) => SKILL_BY_ID.get(id))
    .filter((s) => s !== undefined)
    .map((s) => `${s.id} — ${s.name}`);
  return [
    WORK_SHORTLIST_HEADING,
    skills.length ? skills.join("\n") : "(none)",
    "",
    `Job type ids: ${CATEGORY_IDS.join(", ")}`,
    `Domain ids: ${DOMAIN_IDS.join(", ")}`,
  ].join("\n");
}

/** Entry-level names: those in the title and summary. */
export const ENTRY_NAMES_RULE =
  '- clientNames: every client or company name in the title or summary, each with a generic phrase to use instead that shares no word with it, like {"name": "Acme Realty", "generic": "a real-estate agency"}. Empty if none.';

/** Line-level names, listed under outcomes or highlights. */
export const CLIENT_NAMES_RULE =
  "  clientNames: the same, for every client or company name in that line.";

export const NEVER_INVENT =
  "Never invent anything. Leave out what the block doesn't say, and use unknown rather than guess.";
