import { createHash } from "node:crypto";
import {
  completeImportJob,
  createDb,
  enqueueImportJob,
  importJobs,
  llmUsage,
  syncReferenceData,
  users,
  type ImportJob,
  type ImportStage,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { suggestionsSchema } from "@redlance/core";
import { createClient, createFakeTransport, LlmError } from "@redlance/llm";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeDocx } from "../../test/fixtures";
import { parseWorkerEnv } from "../env";
import {
  stubResumeResponder as fakeResumeResponder,
  stepOf,
} from "../../test/stub-llm";
import { createLogger } from "../logger";
import { resumeCacheKey } from "../resume/pipeline";
import { resumeHandler } from "./resume";
import { JobError, type JobContext } from "./types";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 4 });
const env = parseWorkerEnv({
  APP_ENV: "test",
  DATABASE_URL: url,
  GOOGLE_CLOUD_PROJECT: "test",
  GOOGLE_CLOUD_LOCATION: "global",
});
const log = createLogger("silent");
const llm = createClient(createFakeTransport(fakeResumeResponder));

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await pool.end();
});

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `${Math.random()}@example.com`,
    })
    .returning();
  return u!.id;
}

const LINES = [
  "Jane Doe",
  "Full-stack developer",
  "Summary",
  "I build web apps for startups with React and Node.js, from the first sketch to production.",
  "Experience",
  "Freelance developer, Jan 2020 - Jan 2024",
  "Built React dashboards and Node.js APIs for twelve clients across fintech and retail.",
  "Skills",
  "React, TypeScript, Node.js, PostgreSQL",
];

/** Enqueues a resume and claims it, as the runner would. */
async function claimed(
  userId: string,
  bytes: Uint8Array,
  fileType: "pdf" | "docx" = "docx",
) {
  const id = await enqueueImportJob(db, {
    userId,
    kind: "resume",
    input: { filename: "cv.docx", size: bytes.length },
    fileBytes: bytes,
    fileType,
  });
  // Claim this job (other queued jobs, e.g. an auto-enqueued GitHub import, stay queued).
  const [job] = await db
    .update(importJobs)
    .set({ status: "running", attempts: 1, lockedAt: sql`now()` })
    .where(eq(importJobs.id, id))
    .returning();
  return job!;
}

function ctxFor(job: ImportJob, client = llm) {
  const stages: ImportStage[] = [];
  const ctx: JobContext = {
    db,
    log,
    env,
    llm: client,
    signal: new AbortController().signal,
    async setStage(stage) {
      stages.push(stage);
    },
  };
  return { ctx, stages };
}

const row = async (id: string) =>
  (await db.select().from(importJobs).where(eq(importJobs.id, id)))[0]!;
const usageRows = () => db.select().from(llmUsage);

describe("resumeHandler", () => {
  it("reads a DOCX, clears the file and returns suggestions", async () => {
    const userId = await newUser();
    const job = await claimed(userId, makeDocx(LINES));
    const { ctx, stages } = ctxFor(job);
    const out = await resumeHandler(job, ctx);

    const result = out.result as {
      basics: { displayName?: string };
      skills: { id: string }[];
    };
    expect(result.basics.displayName).toBe("Jane Doe");
    expect(result.skills.map((s) => s.id)).toEqual(
      expect.arrayContaining(["react"]),
    );
    expect(out.pipelineVersion).toBe(
      "resume@2|basics@1|jobTypes@1|skills@1|projects@2|experience@2|" +
        `${env.VERTEX_MODEL_FAST}|${env.VERTEX_MODEL_SMART}`,
    );
    expect(out.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.sourceText).toContain("Jane Doe");
    expect(stages).toEqual(["reading", "analysing", "checking"]);

    const r = await row(job.id);
    expect(r.fileBytes).toBeNull();
    expect(r.sourceText).toContain("Jane Doe");

    // LINES has an Experience heading and no Projects heading: projects is skipped.
    const usage = await usageRows();
    expect(usage).toHaveLength(4);
    expect(usage.map((u) => u.promptVersion).sort()).toEqual([
      "basics@1",
      "experience@2",
      "jobTypes@1",
      "skills@1",
    ]);
    for (const u of usage) {
      expect(u.userId).toBe(userId);
      expect(u.importJobId).toBe(job.id);
      expect(u.task).toBe("resume_import");
      expect(u.outcome).toBe("ok");
      expect(u.attempt).toBe(1);
    }
  });

  it("resumes from the stored text when the file is already gone", async () => {
    const userId = await newUser();
    const job = await claimed(userId, makeDocx(LINES));
    const { ctx } = ctxFor(job);
    const text = (await resumeHandler(job, ctx)).sourceText!;
    const retry = { ...job, fileBytes: null, sourceText: text };
    const out = await resumeHandler(retry, ctxFor(retry).ctx);
    expect(out.sourceText).toBe(text);
  });

  it("reuses a cached result for the same text without calling the model", async () => {
    const userId = await newUser();
    const first = await claimed(userId, makeDocx(LINES));
    const out1 = await resumeHandler(first, ctxFor(first).ctx);
    await db
      .update(importJobs)
      .set({
        status: "done",
        result: out1.result,
        contentHash: out1.contentHash,
        pipelineVersion: out1.pipelineVersion,
      })
      .where(eq(importJobs.id, first.id));

    const other = await newUser();
    const second = await claimed(other, makeDocx(LINES));
    const { ctx, stages } = ctxFor(second);
    const out2 = await resumeHandler(second, ctx);
    expect(out2.result).toEqual(out1.result);
    expect(out2.contentHash).toBe(out1.contentHash);
    expect(stages).toEqual(["reading", "checking"]);
    expect(await usageRows()).toHaveLength(4);
  });

  it("misses the cache when a model name changes", async () => {
    const userId = await newUser();
    const first = await claimed(userId, makeDocx(LINES));
    const out1 = await resumeHandler(first, ctxFor(first).ctx);
    await completeImportJob(db, first.id, first.attempts, out1);

    const second = await claimed(userId, makeDocx(LINES));
    const { ctx, stages } = ctxFor(second);
    ctx.env = { ...env, VERTEX_MODEL_SMART: "some-newer-model" };
    const out2 = await resumeHandler(second, ctx);
    expect(stages).toEqual(["reading", "analysing", "checking"]);
    expect(out2.contentHash).toBe(out1.contentHash);
    expect(out2.pipelineVersion).not.toBe(out1.pipelineVersion);
    expect(out2.pipelineVersion).toContain("some-newer-model");
  });

  it("never caches a partial result", async () => {
    const userId = await newUser();
    const flaky = createClient(
      createFakeTransport((req) => {
        if (stepOf(req) === "skills") throw new LlmError("server", "down");
        return fakeResumeResponder(req);
      }),
      { sleep: async () => {} },
    );
    const first = await claimed(userId, makeDocx(LINES));
    const out1 = await resumeHandler(first, ctxFor(first, flaky).ctx);
    expect(
      (out1.result as { meta: { partial: string[] } }).meta.partial,
    ).toEqual(["skills"]);
    expect(out1.contentHash).toBeUndefined();
    expect(out1.pipelineVersion).toBeUndefined();
    await completeImportJob(db, first.id, first.attempts, out1);

    // An older row that did store a partial result under the hash is ignored too.
    const hash = createHash("sha256").update(out1.sourceText!).digest("hex");
    await db
      .update(importJobs)
      .set({ contentHash: hash, pipelineVersion: resumeCacheKey(env) })
      .where(eq(importJobs.id, first.id));

    const before = (await usageRows()).length;
    const second = await claimed(userId, makeDocx(LINES));
    const { ctx, stages } = ctxFor(second);
    const out2 = await resumeHandler(second, ctx);
    expect(stages).toEqual(["reading", "analysing", "checking"]);
    expect((await usageRows()).length).toBe(before + 4);
    expect(out2.contentHash).toBe(hash);
  });

  it("stores v2 suggestions with checked projects and experience", async () => {
    const userId = await newUser();
    const job = await claimed(
      userId,
      makeDocx([
        "Jane Doe",
        "Full-stack developer",
        "Summary",
        "I build web apps for startups with React and Node.js, from the first sketch to production.",
        "Experience",
        "Freelance Developer, Bright Studio · Jan 2020 – Present",
        "- Built React dashboards for Globex Bank's analysts.",
        "Projects",
        "Shopfront — Next.js store, 2023 · github.com/jane/shopfront",
        "- Cut page load to 1 s for Acme Realty's agents.",
        "Skills",
        "React, TypeScript, Node.js, PostgreSQL",
      ]),
    );
    const out = await resumeHandler(job, ctxFor(job).ctx);
    await completeImportJob(db, job.id, job.attempts, out);

    // What the web app reads back: the stored row, parsed as v2.
    const stored = suggestionsSchema.parse((await row(job.id)).result);
    expect(stored.v).toBe(2);
    expect(stored.meta?.partial).toEqual([]);
    expect(stored.meta?.skipped).toEqual([]);
    expect(stored.meta?.promptVersions).toMatchObject({
      projects: "projects@2",
      experience: "experience@2",
    });
    expect(stored.projects).toEqual([
      expect.objectContaining({
        title: "Shopfront",
        year: 2023,
        links: ["https://github.com/jane/shopfront"],
        outcomes: ["Cut page load to 1 s for a client's agents."],
        namesRemoved: true,
      }),
    ]);
    expect(stored.experience).toEqual([
      expect.objectContaining({
        title: "Freelance Developer",
        organisation: null,
        employmentType: "freelance",
        start: { year: 2020, month: 1 },
        end: null,
        current: true,
        highlights: ["Built React dashboards for a client's analysts."],
        namesRemoved: true,
      }),
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/acme|globex|bright/i);
    expect((await usageRows()).map((u) => u.step).sort()).toEqual([
      "basics",
      "experience",
      "jobTypes",
      "projects",
      "skills",
    ]);
  });

  it("does not reuse a result cached by resume@1", async () => {
    const userId = await newUser();
    const first = await claimed(userId, makeDocx(LINES));
    const out1 = await resumeHandler(first, ctxFor(first).ctx);
    // The same text analysed by the old pipeline: same hash, the resume@1 key.
    const oldKey = resumeCacheKey(env)
      .replace("resume@2", "resume@1")
      .replace("|projects@2|experience@2", "");
    expect(oldKey).toBe(
      `resume@1|basics@1|jobTypes@1|skills@1|${env.VERTEX_MODEL_FAST}|${env.VERTEX_MODEL_SMART}`,
    );
    await completeImportJob(db, first.id, first.attempts, {
      ...out1,
      pipelineVersion: oldKey,
    });

    const before = (await usageRows()).length;
    const second = await claimed(userId, makeDocx(LINES));
    const { ctx, stages } = ctxFor(second);
    const out2 = await resumeHandler(second, ctx);
    expect(stages).toEqual(["reading", "analysing", "checking"]);
    expect((await usageRows()).length).toBe(before + 4);
    expect(out2.contentHash).toBe(out1.contentHash);
    expect(out2.pipelineVersion).toBe(resumeCacheKey(env));
  });

  it("enqueues one GitHub import for a username in the resume, only once", async () => {
    const userId = await newUser();
    const lines = [...LINES, "Code: github.com/octocat"];
    const a = await claimed(userId, makeDocx(lines));
    const out = await resumeHandler(a, ctxFor(a).ctx);
    expect(
      (out.result as { githubUsername: string | null }).githubUsername,
    ).toBe("octocat");

    const b = await claimed(
      userId,
      makeDocx([...lines, "Also available for contract work."]),
    );
    await resumeHandler(b, ctxFor(b).ctx);

    const gh = await db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), eq(importJobs.kind, "github")));
    expect(gh).toHaveLength(1);
    expect(gh[0]!.input).toEqual({ username: "octocat", fromResume: true });
  });

  it("fails with NO_TEXT for a very short resume", async () => {
    const userId = await newUser();
    const job = await claimed(
      userId,
      makeDocx(["Jane Doe", "Developer, React and Node.js."]),
    );
    const err = await resumeHandler(job, ctxFor(job).ctx).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err.code).toBe("NO_TEXT");
    expect(err.retryable).toBe(false);
    expect(await usageRows()).toHaveLength(0);
  });

  it("fails with UNSUPPORTED_FILE for random bytes", async () => {
    const userId = await newUser();
    const bytes = new Uint8Array(2048).map((_, i) => (i * 7919) % 256);
    const job = await claimed(userId, bytes, "pdf");
    const err = await resumeHandler(job, ctxFor(job).ctx).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err.code).toBe("UNSUPPORTED_FILE");
    expect(err.retryable).toBe(false);
  });
});
