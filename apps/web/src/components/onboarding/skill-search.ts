import { findSkill, normalizeSkillName, type Skill } from "@redlance/core";

export type EnterAction = { type: "skill"; id: string } | { type: "none" };

/**
 * What Enter does in the skill search: the skill that was typed, else the first result whose
 * name or alias starts with the text, else nothing (only taxonomy skills can be added).
 * `results` must already exclude chosen skills.
 */
export function enterAction(
  query: string,
  ctx: { results: readonly Skill[]; chosen: ReadonlySet<string> },
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
  return prefixMatch ? { type: "skill", id: prefixMatch.id } : { type: "none" };
}
