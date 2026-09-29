import { fetchGithubProfile } from "../github/client";
import { mapGithubToSuggestions } from "../github/map";
import { JobError, type JobHandler } from "./types";

export function makeGithubHandler(fetchFn?: typeof fetch): JobHandler {
  return async (job, ctx) => {
    const username = (job.input as { username?: unknown }).username;
    if (typeof username !== "string")
      throw new JobError("GITHUB_NOT_FOUND", false);
    await ctx.setStage("reading");
    const profile = await fetchGithubProfile(username, {
      token: ctx.env.GITHUB_TOKEN,
      fetch: fetchFn,
    });
    await ctx.setStage("checking");
    return { result: mapGithubToSuggestions(profile) };
  };
}

export const githubHandler: JobHandler = makeGithubHandler();
