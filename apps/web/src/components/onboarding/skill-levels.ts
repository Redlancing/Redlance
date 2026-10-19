export type SkillLevel = "core" | "secondary";

/** How many of the first skills added start as core; the user can change any of them. */
export const DEFAULT_CORE = 3;

export function nextSkillLevel(
  coreCount: number,
  coreLimit: number,
): SkillLevel {
  return coreCount < Math.min(DEFAULT_CORE, coreLimit) ? "core" : "secondary";
}
