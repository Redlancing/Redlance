import type { CategoryId } from "./taxonomy";

export type SeedSubreddit = { name: string; categories: readonly CategoryId[] };

/**
 * Seed list, unverified: the ingestion spec checks each board's rules and hiring tags
 * before polling it. Lowercase, no "r/". Empty `categories` = general board, given to everyone.
 */
export const SUBREDDITS: readonly SeedSubreddit[] = [
  { name: "forhire", categories: [] },
  { name: "hiring", categories: [] },
  { name: "jobbit", categories: [] },
  { name: "freelance_forhire", categories: [] },
  { name: "hireaprogrammer", categories: ["development", "data"] },
  { name: "remotejs", categories: ["development"] },
  { name: "gamedevclassifieds", categories: ["games", "3d", "art", "audio"] },
  { name: "designjobs", categories: ["design"] },
  { name: "hungryartists", categories: ["art", "design", "3d"] },
  { name: "artcommissions", categories: ["art"] },
  { name: "commissions", categories: ["art"] },
  { name: "videoeditingrequests", categories: ["video"] },
  { name: "photoshoprequest", categories: ["photo"] },
  { name: "voiceacting", categories: ["audio"] },
  { name: "hireawriter", categories: ["writing"] },
  { name: "freelancewriters", categories: ["writing"] },
];

export function subredditsFor(categories: readonly string[]): string[] {
  return SUBREDDITS.filter(
    (s) => s.categories.length === 0 || s.categories.some((c) => categories.includes(c)),
  ).map((s) => s.name);
}
