import { CATEGORY_IDS, DOMAIN_IDS } from "@redlance/core";

/** The fixed lists the work call shows the model: job type ids and domain ids. */
export const WORK_LISTS = [
  `Job type ids: ${CATEGORY_IDS.join(", ")}`,
  `Domain ids: ${DOMAIN_IDS.join(", ")}`,
].join("\n");

/** Entry-level names: those in the title and summary. */
export const ENTRY_NAMES_RULE =
  '- clientNames: every client or company name in the title or summary, each with a generic phrase to use instead that shares no word with it, like {"name": "Acme Realty", "generic": "a real-estate agency"}. Empty if none.';

/** Line-level names, listed under outcomes or highlights. */
export const CLIENT_NAMES_RULE =
  "  clientNames: the same, for every client or company name in that line.";

export const NEVER_INVENT =
  "Never invent anything. Leave out what an entry's lines don't say, and use unknown rather than guess.";
