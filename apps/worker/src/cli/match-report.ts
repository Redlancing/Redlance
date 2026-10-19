// Pure text for `ingest:status` (the Matching section) and `match:status` (one user).
// No database or env access here, so the tests need neither.
import type { MatchingStats, UserMatchReport } from "@redlance/db";

const TITLE_MAX = 60;

/** The Matching section of `npm run ingest:status`. */
export function formatMatchingSection(s: MatchingStats): string {
  const dollars = `$${(s.rescoreSpendMicros / 1e6).toFixed(4)}`;
  return [
    "Matching",
    `  Posts (24 h): ${s.posts.pending} pending, ${s.posts.running} running, ${s.posts.done} done, ${s.posts.skipped} skipped`,
    `  Matches (24 h): ${s.matchesCreated} created, ${s.matchesBroad} broad`,
    `  AI (24 h): ${s.ai.done} done, ${s.ai.capped} capped, ${s.ai.failed} failed · ${s.ai.pending} pending now`,
    `  Re-score spend today (UTC): ${dollars} · ${s.usersAtCap} users at cap`,
  ].join("\n");
}

export type MatchRow = { title: string; score: number; reason: string };

/** The best `limit` matches by score, one line each; titles cut to 60 characters. */
export function formatUserMatches(rows: MatchRow[], limit = 5): string[] {
  return [...rows]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(
      (r) =>
        `  ${String(r.score).padStart(3)}  ${truncate(r.title, TITLE_MAX)}  ·  ${r.reason}`,
    );
}

/** The report `npm run match:status` prints for one user. */
export function formatUserReport(r: UserMatchReport): string {
  const trial =
    r.plan === "trial"
      ? ` (trial ends ${r.trialEndsAt.toISOString().slice(0, 10)})`
      : "";
  const ai = r.aiAllowed ? "AI allowed" : "AI not allowed";
  const count = (counts: Record<string, number>) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ") || "none";
  const lines = [
    `Plan: ${r.plan}${trial} · ${ai}`,
    `Re-scores today: ${r.usedToday} / ${r.cap}`,
    `Matches by AI status: ${count(r.byAiStatus)}`,
    `Matches by status: ${count(r.byStatus)}`,
  ];
  if (r.top.length) {
    lines.push("Top matches:", ...formatUserMatches(r.top));
  } else {
    lines.push("No matches yet.");
  }
  return lines.join("\n");
}

/** match:status prints one user's data, so it refuses unless APP_ENV is local or test. */
export function refusalFor(appEnv: string | undefined): string | null {
  if (appEnv === "local" || appEnv === "test") return null;
  return `match:status prints one user's data, so it only runs with APP_ENV=local or test (APP_ENV is ${appEnv ?? "unset"}).`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
