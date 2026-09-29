import { normalizeSkillName } from "@redlance/core";
import { containsLabel } from "./prepass";

const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The quote must be substantial (12+ characters or 2+ words) and appear in the text. */
export function hasEvidence(text: string, quote: string | undefined): boolean {
  if (!quote) return false;
  const q = norm(quote);
  if (q.length < 12 && q.split(" ").length < 2) return false;
  return norm(text).includes(q);
}

/** Like hasEvidence, and the quote must also mention one of the skill's labels. */
export function hasSkillEvidence(
  text: string,
  quote: string | undefined,
  labels: string[],
): boolean {
  if (!hasEvidence(text, quote)) return false;
  const q = norm(quote!);
  return labels.some((l) => {
    const label = normalizeSkillName(l);
    return label !== "" && containsLabel(q, label);
  });
}
