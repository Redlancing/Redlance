import { z } from "zod";
import { checkGithubInput } from "@redlance/core";
import { JobError } from "../jobs/types";
import type { GithubRepo } from "./map";

type GithubDeps = {
  token?: string;
  fetch?: typeof fetch;
  /** The job's signal: aborting it (worker shutdown) fails with SHUTDOWN. */
  signal?: AbortSignal;
};

const API = "https://api.github.com";
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;

const userSchema = z.object({
  login: z.string().min(1).max(100),
  name: z.string().max(500).nullable().optional(),
});

const repoSchema = z.object({
  name: z.string().max(500),
  fork: z.boolean(),
  archived: z.boolean(),
  language: z.string().max(100).nullable(),
  topics: z.array(z.string().max(100)).max(100).default([]),
  stargazers_count: z.number().int().nonnegative(),
  pushed_at: z
    .string()
    .max(40)
    .nullable()
    .transform((v) => v ?? ""),
  description: z.string().max(5000).nullable(),
});
const reposSchema = z.array(repoSchema).max(100);

/** Reads the body as a stream and stops as soon as it goes over the cap. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES)
    throw new JobError("GITHUB_TOO_LARGE", false);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new JobError("GITHUB_TOO_LARGE", false);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A network failure, or SHUTDOWN when the job itself was aborted. */
const unavailable = (deps: GithubDeps) =>
  deps.signal?.aborted
    ? new JobError("SHUTDOWN", true, "stopped before GitHub answered")
    : new JobError("GITHUB_UNAVAILABLE", true);

async function getJson<S extends z.ZodType>(
  url: string,
  schema: S,
  deps: GithubDeps,
): Promise<z.output<S>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Redlance (+https://redlance.app)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: deps.signal
        ? AbortSignal.any([deps.signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable(deps);
  }

  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    throw new JobError("GITHUB_NOT_FOUND", false);
  }
  if (res.status === 429 || res.status === 403) {
    await res.body?.cancel().catch(() => {});
    const limited =
      res.status === 429 ||
      res.headers.get("x-ratelimit-remaining") === "0" ||
      res.headers.has("retry-after");
    throw new JobError(
      limited ? "GITHUB_RATE_LIMITED" : "GITHUB_UNAVAILABLE",
      true,
    );
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new JobError("GITHUB_UNAVAILABLE", true);
  }

  let text: string;
  try {
    text = await readCapped(res);
  } catch (e) {
    if (e instanceof JobError) throw e;
    throw unavailable(deps);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JobError("GITHUB_UNAVAILABLE", true);
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) throw new JobError("GITHUB_UNAVAILABLE", true);
  return checked.data;
}

export async function fetchGithubProfile(
  username: string,
  deps: GithubDeps = {},
): Promise<{ login: string; name: string | null; repos: GithubRepo[] }> {
  const check = checkGithubInput(username);
  if (!check.ok || !check.username || check.username !== username.trim())
    throw new JobError("GITHUB_NOT_FOUND", false);
  const u = check.username;

  const user = await getJson(`${API}/users/${u}`, userSchema, deps);
  const repos = await getJson(
    `${API}/users/${u}/repos?type=owner&sort=pushed&per_page=100`,
    reposSchema,
    deps,
  );
  return { login: user.login, name: user.name ?? null, repos };
}
