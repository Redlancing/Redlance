import { checkGithubInput, suggestionsSchema } from "@redlance/core";
import { fetchGithubProfile } from "../github/client";
import { mapGithubToSuggestions } from "../github/map";
import { JobError, type JobHandler } from "./types";

export function makeGithubHandler(fetchFn?: typeof fetch): JobHandler {
  return async (job, ctx) => {
    const input = (job.input as { username?: unknown }).username;
    const check =
      typeof input === "string" ? checkGithubInput(input) : undefined;
    if (!check?.ok || !check.username)
      throw new JobError("GITHUB_NOT_FOUND", false);
    const username = check.username;
    await ctx.setStage("reading");
    const profile = await fetchGithubProfile(username, {
      token: ctx.env.GITHUB_TOKEN,
      fetch: fetchFn,
      signal: ctx.signal,
    });
    await ctx.setStage("checking");
    // The username the user gave (already validated) is what we store, not
    // whatever login the API returned.
    const parsed = suggestionsSchema.safeParse(
      mapGithubToSuggestions({ ...profile, login: username }),
    );
    if (!parsed.success) {
      ctx.log?.error(
        { errName: parsed.error.name },
        "GitHub suggestions failed the schema",
      );
      throw new JobError("GITHUB_UNAVAILABLE", false);
    }
    ctx.dev?.github({
      username,
      repos: profile.repos,
      suggestions: parsed.data,
    });
    return { result: parsed.data };
  };
}

export const githubHandler: JobHandler = makeGithubHandler();
