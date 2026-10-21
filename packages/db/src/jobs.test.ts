import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IMPORT_JOBS_CHANNEL,
  MAX_JOB_ATTEMPTS,
  claimNextImportJob,
  clearImportFile,
  completeImportJob,
  createDb,
  enqueueImportJob,
  failImportJob,
  findCachedResumeResult,
  importJobs,
  latestImportJobs,
  llmUsage,
  recordLlmUsage,
  requeueStaleImportJobs,
  setImportStage,
  syncReferenceData,
  users,
} from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table llm_usage`);
});
afterAll(async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table llm_usage`);
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
  return u!;
}

async function enqueue(userId: string, withFile = true) {
  return enqueueImportJob(db, {
    userId,
    kind: "resume",
    input: { name: "cv" },
    ...(withFile
      ? { fileBytes: new Uint8Array([1, 2, 3]), fileType: "pdf" as const }
      : {}),
  });
}

async function row(id: string) {
  const [r] = await db.select().from(importJobs).where(eq(importJobs.id, id));
  return r!;
}

describe("enqueueImportJob", () => {
  it("returns a UUIDv7, stores a queued row and notifies listeners after commit", async () => {
    const u = await newUser();
    const listener = new pg.Client({ connectionString: url });
    await listener.connect();
    try {
      await listener.query(`LISTEN ${IMPORT_JOBS_CHANNEL}`);
      const got = new Promise<string>((resolve) =>
        listener.on("notification", (m) => resolve(m.payload ?? "")),
      );
      const id = await enqueue(u.id);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const r = await row(id);
      expect(r.status).toBe("queued");
      expect(r.stage).toBe("queued");
      expect(r.fileBytes).toEqual(Buffer.from([1, 2, 3]));
      expect(await got).toBe(id);
    } finally {
      await listener.end();
    }
  });
});

describe("claimNextImportJob", () => {
  it("claims once and marks the job running", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    const job = await claimNextImportJob(db);
    expect(job?.id).toBe(id);
    expect(job?.status).toBe("running");
    expect(job?.attempts).toBe(1);
    expect(job?.lockedAt).toBeInstanceOf(Date);
    expect(await claimNextImportJob(db)).toBeNull();
  });

  it("never hands one job to two callers", async () => {
    const u = await newUser();
    for (let i = 0; i < 5; i++) await enqueue(u.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimNextImportJob(db)),
    );
    const ids = results.filter((r) => r !== null).map((r) => r!.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(results.filter((r) => r === null)).toHaveLength(5);
  });

  it("skips jobs whose run_after is in the future", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await db.execute(
      sql`update import_jobs set run_after = now() + interval '1 minute' where id = ${id}`,
    );
    expect(await claimNextImportJob(db)).toBeNull();
  });
});

describe("setImportStage and clearImportFile", () => {
  it("updates the stage and clears the file", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    await setImportStage(db, id, 1, "reading");
    await clearImportFile(db, id, 1, "cv text");
    const r = await row(id);
    expect(r.stage).toBe("reading");
    expect(r.fileBytes).toBeNull();
    expect(r.sourceText).toBe("cv text");
  });

  it("ignores writes from a worker that does not own the claim", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    await setImportStage(db, id, 2, "reading");
    await clearImportFile(db, id, 2, "x");
    const r = await row(id);
    expect(r.stage).toBe("queued");
    expect(r.fileBytes).not.toBeNull();
    expect(r.sourceText).toBeNull();
  });
});

describe("failImportJob", () => {
  it("re-queues a retryable failure with backoff and keeps the file", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    expect(
      await failImportJob(db, id, 1, { errorCode: "X", retryable: true }),
    ).toBe("requeued");
    const r = await row(id);
    expect(r.status).toBe("queued");
    expect(r.stage).toBe("queued");
    expect(r.lockedAt).toBeNull();
    expect(r.fileBytes).not.toBeNull();
    expect(r.runAfter.getTime()).toBeGreaterThanOrEqual(Date.now() + 3_500);
    expect(r.runAfter.getTime()).toBeLessThan(Date.now() + 6_500);
  });

  it("fails for good once attempts are used up, deleting the text", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await db.execute(
      sql`update import_jobs set status = 'running', attempts = ${MAX_JOB_ATTEMPTS}, source_text = 'cv text' where id = ${id}`,
    );
    expect(
      await failImportJob(db, id, MAX_JOB_ATTEMPTS, {
        errorCode: "X",
        retryable: true,
      }),
    ).toBe("failed");
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.stage).toBe("failed");
    expect(r.errorCode).toBe("X");
    expect(r.fileBytes).toBeNull();
    expect(r.sourceText).toBeNull();
    expect(r.finishedAt).toBeInstanceOf(Date);
  });

  it("fails a non-retryable error on the first attempt", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    expect(
      await failImportJob(db, id, 1, {
        errorCode: "NO_TEXT",
        retryable: false,
      }),
    ).toBe("failed");
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.fileBytes).toBeNull();
  });
});

describe("fencing", () => {
  it("rejects late writes from a worker whose claim was swept", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db); // attempts 1
    await db.execute(
      sql`update import_jobs set locked_at = now() - interval '3 minutes' where id = ${id}`,
    );
    expect(await requeueStaleImportJobs(db)).toBe(1);
    const second = await claimNextImportJob(db);
    expect(second?.attempts).toBe(2);
    const before = await row(id);
    expect(
      await failImportJob(db, id, 1, { errorCode: "X", retryable: true }),
    ).toBe("lost");
    expect(await completeImportJob(db, id, 1, { result: { late: true } })).toBe(
      false,
    );
    expect(await row(id)).toEqual(before);
    expect(await completeImportJob(db, id, 2, { result: { ok: true } })).toBe(
      true,
    );
    expect((await row(id)).result).toEqual({ ok: true });
  });

  it("keeps extracted text across a retryable failure", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    await clearImportFile(db, id, 1, "cv text");
    expect(
      await failImportJob(db, id, 1, { errorCode: "LLM", retryable: true }),
    ).toBe("requeued");
    await db.execute(
      sql`update import_jobs set run_after = now() where id = ${id}`,
    );
    const again = await claimNextImportJob(db);
    expect(again?.fileBytes).toBeNull();
    expect(again?.sourceText).toBe("cv text");
  });
});

describe("completeImportJob", () => {
  it("stores the result and deletes the file and the text, keeping the cache key", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    await clearImportFile(db, id, 1, "text");
    await completeImportJob(db, id, 1, {
      result: { skills: ["a"] },
      contentHash: "h",
      pipelineVersion: "v1",
    });
    const r = await row(id);
    expect(r.status).toBe("done");
    expect(r.stage).toBe("done");
    expect(r.fileBytes).toBeNull();
    expect(r.result).toEqual({ skills: ["a"] });
    expect(r.sourceText).toBeNull();
    expect(r.contentHash).toBe("h");
    expect(r.pipelineVersion).toBe("v1");
    expect(await findCachedResumeResult(db, "h", "v1")).toEqual({
      skills: ["a"],
    });
    expect(r.finishedAt).toBeInstanceOf(Date);
  });
});

describe("requeueStaleImportJobs", () => {
  it("re-queues stale running jobs and fails those out of attempts", async () => {
    const u = await newUser();
    const a = await enqueue(u.id);
    const b = await enqueue(u.id);
    const fresh = await enqueue(u.id);
    await db.execute(
      sql`update import_jobs set status = 'running', attempts = 1, locked_at = now() - interval '3 minutes' where id = ${a}`,
    );
    await db.execute(
      sql`update import_jobs set status = 'running', attempts = 3, source_text = 'cv', locked_at = now() - interval '3 minutes' where id = ${b}`,
    );
    await db.execute(
      sql`update import_jobs set source_text = 'cv' where id = ${a}`,
    );
    await db.execute(
      sql`update import_jobs set status = 'running', attempts = 1, locked_at = now() where id = ${fresh}`,
    );
    expect(await requeueStaleImportJobs(db)).toBe(2);
    const ra = await row(a);
    expect(ra.status).toBe("queued");
    expect(ra.lockedAt).toBeNull();
    expect(ra.stage).toBe("queued");
    expect(ra.fileBytes).not.toBeNull();
    expect(ra.sourceText).toBe("cv");
    const rb = await row(b);
    expect(rb.status).toBe("failed");
    expect(rb.errorCode).toBe("TIMEOUT");
    expect(rb.fileBytes).toBeNull();
    expect(rb.sourceText).toBeNull();
    expect((await row(fresh)).status).toBe("running");
  });
});

describe("findCachedResumeResult", () => {
  it("only returns done results for the same hash and pipeline version", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await claimNextImportJob(db);
    expect(await findCachedResumeResult(db, "h", "v1")).toBeNull();
    await completeImportJob(db, id, 1, {
      result: { ok: 1 },
      contentHash: "h",
      pipelineVersion: "v1",
    });
    expect(await findCachedResumeResult(db, "h", "v1")).toEqual({ ok: 1 });
    expect(await findCachedResumeResult(db, "h", "v2")).toBeNull();
    expect(await findCachedResumeResult(db, "other", "v1")).toBeNull();
  });
});

describe("latestImportJobs", () => {
  it("returns the newest job per kind for this user, without the heavy columns", async () => {
    const u = await newUser();
    const other = await newUser();
    await enqueue(u.id);
    const newest = await enqueue(u.id);
    await enqueueImportJob(db, { userId: other.id, kind: "github", input: {} });
    const { resume, github } = await latestImportJobs(db, u.id);
    expect(resume?.id).toBe(newest);
    expect(github).toBeNull();
    expect(resume).not.toHaveProperty("fileBytes");
    expect(resume).not.toHaveProperty("sourceText");
  });
});

describe("cascades", () => {
  it("deleting a user removes import jobs and keeps llm_usage with a null user", async () => {
    const u = await newUser();
    const id = await enqueue(u.id);
    await recordLlmUsage(db, {
      userId: u.id,
      importJobId: id,
      task: "resume",
      step: "basics",
      promptVersion: "p1",
      model: "m",
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 42,
      latencyMs: 100,
      attempt: 1,
      outcome: "ok",
    });
    await db.delete(users).where(eq(users.id, u.id));
    expect(await db.select().from(importJobs)).toHaveLength(0);
    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.userId).toBeNull();
    expect(usage[0]!.importJobId).toBeNull();
  });
});
