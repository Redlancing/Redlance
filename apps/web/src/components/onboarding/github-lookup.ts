import { GITHUB_USERNAME_RE } from "@redlance/core";

export type GithubLookup = "found" | "missing" | "unknown";

/**
 * Asks GitHub's public API whether an account exists, straight from the browser: our
 * server never fetches anything the user typed. Only a definite 404 counts as "missing";
 * rate limits, outages and network errors are "unknown" so they never block anyone.
 */
export async function lookupGithubUser(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubLookup> {
  if (!GITHUB_USERNAME_RE.test(username)) return "unknown";
  try {
    const res = await fetchImpl(`https://api.github.com/users/${username}`, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return "missing";
    return res.ok ? "found" : "unknown";
  } catch {
    return "unknown";
  }
}
