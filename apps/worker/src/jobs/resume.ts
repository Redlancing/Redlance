import { createHash } from "node:crypto";
import { suggestionsSchema, type Suggestions } from "@redlance/core";
import {
  clearImportFile,
  enqueueImportJob,
  findCachedResumeResult,
  importJobs,
  recordLlmUsage,
  type Database,
  type ImportJob,
} from "@redlance/db";
import { and, eq } from "drizzle-orm";
import { cleanResumeText, MIN_RESUME_CHARS } from "../resume/clean";
import { ResumeError } from "../resume/errors";
import { extractText } from "../resume/extract";
import { resumeCacheKey, runResumePipeline } from "../resume/pipeline";
import { githubFromText } from "../resume/prepass";
import { JobError, type JobContext, type JobHandler } from "./types";

/** The file's text, or the text saved by an earlier attempt (the file is gone by then). */
async function readText(job: ImportJob, ctx: JobContext): Promise<string> {
  if (!job.fileBytes) {
    if (job.sourceText) return cleanResumeText(job.sourceText);
    throw new JobError("NO_TEXT", false, "neither file nor text is stored");
  }
  if (job.fileType !== "pdf" && job.fileType !== "docx")
    throw new JobError("UNSUPPORTED_FILE", false);
  let raw: string;
  try {
    raw = await extractText(job.fileBytes, job.fileType, { log: ctx.log });
  } catch (e) {
    if (e instanceof ResumeError) throw new JobError(e.code, false, e.message);
    throw e;
  }
  const text = cleanResumeText(raw);
  await clearImportFile(ctx.db, job.id, job.attempts, text);
  return text;
}

async function hasGithubJob(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), eq(importJobs.kind, "github")))
    .limit(1);
  return row !== undefined;
}

export const resumeHandler: JobHandler = async (job, ctx) => {
  await ctx.setStage("reading");
  const text = await readText(job, ctx);
  if (text.length < MIN_RESUME_CHARS) throw new JobError("NO_TEXT", false);

  const contentHash = createHash("sha256").update(text).digest("hex");
  const githubUsername = githubFromText(text);
  let suggestions: Suggestions | null = null;
  let complete = true;

  const cacheKey = resumeCacheKey(ctx.env);
  const cached = suggestionsSchema.safeParse(
    await findCachedResumeResult(ctx.db, contentHash, cacheKey),
  );
  // Only complete results are reused (older rows may predate the no-partial rule).
  if (cached.success && !cached.data.meta?.partial.length) {
    await ctx.setStage("checking");
    suggestions = cached.data;
  } else {
    await ctx.setStage("analysing");
    const usage: Promise<void>[] = [];
    try {
      const run = await runResumePipeline(text, {
        llm: ctx.llm,
        models: {
          fast: ctx.env.VERTEX_MODEL_FAST,
          smart: ctx.env.VERTEX_MODEL_SMART,
        },
        signal: ctx.signal,
        onAttempt: (step, promptVersion, a, model) => {
          usage.push(
            recordLlmUsage(ctx.db, {
              userId: job.userId,
              importJobId: job.id,
              task: "resume_import",
              step,
              promptVersion,
              model: a.usage?.model ?? model,
              inputTokens: a.usage?.inputTokens ?? 0,
              cachedInputTokens: a.usage?.cachedInputTokens ?? 0,
              outputTokens: a.usage?.outputTokens ?? 0,
              costMicros: a.usage?.costMicros ?? 0,
              latencyMs: a.usage?.latencyMs ?? 0,
              attempt: a.attempt,
              outcome: a.outcome,
            }),
          );
        },
      });
      suggestions = run.suggestions;
      complete = run.partial.length === 0;
    } finally {
      // Cost records are kept even when the job fails; a failed insert doesn't fail the job.
      for (const r of await Promise.allSettled(usage))
        if (r.status === "rejected")
          ctx.log.error(
            { err: (r.reason as Error).message },
            "could not record llm usage",
          );
    }
    await ctx.setStage("checking");
  }

  suggestions = { ...suggestions, githubUsername };
  if (githubUsername && !(await hasGithubJob(ctx.db, job.userId))) {
    await enqueueImportJob(ctx.db, {
      userId: job.userId,
      kind: "github",
      input: { username: githubUsername, fromResume: true },
    });
  }

  // A partial result isn't cached: a one-off step failure mustn't stick to this text.
  return complete
    ? {
        result: suggestions,
        sourceText: text,
        contentHash,
        pipelineVersion: cacheKey,
      }
    : { result: suggestions, sourceText: text };
};
