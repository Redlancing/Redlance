/**
 * Client-name removal (projects-experience-design.md, "Removing client names"). Pure.
 *
 * The name matching and replacing lives in @redlance/core (`client-names.ts`), shared with the
 * matching re-score context; this module adds link removal, which needs the resume TLD list.
 */

import { linkNamesClient } from "@redlance/core";
import { TLDS } from "./prepass";

export {
  DEFAULT_GENERIC,
  MAX_GENERIC_CHARS,
  MAX_NAME_CHARS,
  cutPartialName,
  findOrganisation,
  linkNamesClient,
  nameOccurs,
  replaceNames,
  sharesNameWord,
  type ClientName,
} from "@redlance/core";

const URL_IN_TEXT = new RegExp(
  [
    "(?:https?:\\/\\/|www\\.)[^\\s<>\"'`|·•]+",
    `(?<![\\w.@/-])(?:[a-z0-9-]+\\.)+(?:${TLDS})(?![\\w-])(?:\\/[^\\s<>"'\`|·•]*)?`,
  ].join("|"),
  "gi",
);

/** Removes links and bare domains that name a client (see `linkNamesClient`). */
export function removeNamedUrls(
  text: string,
  names: readonly string[],
): string {
  let hit = false;
  const out = text.replace(URL_IN_TEXT, (m) => {
    if (!linkNamesClient(m.replace(/[.,;:!?)]+$/, ""), names)) return m;
    hit = true;
    return " ";
  });
  if (!hit) return text;
  return out
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim()
    .replace(/^[\s|·•,;:/–—-]+|[\s|·•,;:/–—-]+$/g, "")
    .trim();
}
