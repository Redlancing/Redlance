import { SKILL_BY_ID } from "../taxonomy";
import type { Feature } from "./score";

const MAX_REASON = 120;
const MAX_NAMES = 3;

export const RED_FLAG_TEXT: Record<string, string> = {
  asks_for_free_work: "asks for free work",
  off_platform_payment: "off-platform payment",
  upfront_fee: "upfront fee",
  vague_pay: "vague pay",
  personal_info_request: "asks for personal info",
};

export function skillDisplayName(id: string): string {
  return SKILL_BY_ID.get(id)?.name ?? id;
}

function names(ids: string[], skillName: (id: string) => string): string {
  const shown = ids.slice(0, MAX_NAMES).map(skillName).join(", ");
  const more = ids.length - MAX_NAMES;
  return more > 0 ? `${shown} +${more}` : shown;
}

/** A short, human line for a rule score, built from its features. Never shows ids. */
export function ruleReason(
  features: Feature[],
  skillName: (id: string) => string = skillDisplayName,
  broad = false,
): string {
  const parts: string[] = [];
  for (const f of features) {
    const detail = f.detail ?? [];
    switch (f.signal) {
      case "core_skill":
        parts.push(
          detail.length === 1
            ? `core skill (${names(detail, skillName)})`
            : `${detail.length} of your core skills (${names(detail, skillName)})`,
        );
        break;
      case "secondary_skill":
        parts.push(
          `${detail.length} secondary ${detail.length === 1 ? "skill" : "skills"} (${names(detail, skillName)})`,
        );
        break;
      case "job_type":
        if (broad) parts.unshift("Broad match: shares your job type");
        else parts.push("your job type");
        break;
      case "budget_fits":
        parts.push("budget fits");
        break;
      case "budget_below":
        parts.push("budget below your minimum");
        break;
      case "work_overlap":
        parts.push("like your past work");
        break;
      case "remote_fit":
        parts.push("remote");
        break;
      case "red_flag":
        parts.push(
          `red flag: ${detail.map((d) => RED_FLAG_TEXT[d] ?? d.replaceAll("_", " ")).join(", ")}`,
        );
        break;
    }
  }
  if (parts.length === 0) return broad ? "Broad match" : "Weak match";
  // Too long: drop detail parts from the end, but keep the first part and any red flag.
  while (parts.join(" · ").length > MAX_REASON) {
    let drop = -1;
    for (let i = parts.length - 1; i > 0; i--) {
      if (!parts[i]!.startsWith("red flag")) {
        drop = i;
        break;
      }
    }
    if (drop < 0) break;
    parts.splice(drop, 1);
  }
  const text = parts.join(" · ");
  return text.length <= MAX_REASON
    ? text
    : `${text.slice(0, MAX_REASON - 1).trimEnd()}…`;
}
