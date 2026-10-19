import { findSkill, normalizeSkillName, type Skill } from "@redlance/core";

export type EnterAction =
  { type: "skill"; id: string } | { type: "custom" } | { type: "none" };

/**
 * What Enter does in the skill search: the skill that was typed, else the first result whose
 * name or alias starts with the text, else the custom skill the UI offers, else nothing.
 * `results` must already exclude chosen skills.
 */
export function enterAction(
  query: string,
  ctx: {
    results: readonly Skill[];
    chosen: ReadonlySet<string>;
    canAddCustom: boolean;
  },
): EnterAction {
  const found = findSkill(query);
  if (found && !found.retired)
    return ctx.chosen.has(found.id)
      ? { type: "none" }
      : { type: "skill", id: found.id };
  const q = normalizeSkillName(query);
  const prefixMatch = q
    ? ctx.results.find((s) =>
        [s.name, ...s.aliases].some((l) => normalizeSkillName(l).startsWith(q)),
      )
    : undefined;
  if (prefixMatch) return { type: "skill", id: prefixMatch.id };
  return ctx.canAddCustom ? { type: "custom" } : { type: "none" };
}
