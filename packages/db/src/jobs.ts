import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  importJobs,
  llmUsage,
  type ImportJob,
  type ImportKind,
  type ImportStage,
} from "./schema";

export const IMPORT_JOBS_CHANNEL = "import_jobs";
export const MAX_JOB_ATTEMPTS = 3;

/** Adds a job and wakes the worker (NOTIFY is delivered when the transaction commits). */
export async function enqueueImportJob(
  db: Database,
  job: {
    userId: string;
    kind: ImportKind;
    input: Record<string, unknown>;
    fileBytes?: Uint8Array;
    fileType?: "pdf" | "docx";
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(importJobs)
      .values({
        userId: job.userId,
        kind: job.kind,
        input: job.input,
        fileBytes: job.fileBytes ? Buffer.from(job.fileBytes) : null,
        fileType: job.fileType ?? null,
      })
      .returning({ id: importJobs.id });
    const id = row!.id;
    await tx.execute(sql`select pg_notify(${IMPORT_JOBS_CHANNEL}, ${id})`);
    return id;
  });
}

/** Takes the oldest due job. SKIP LOCKED lets several workers claim without blocking or doubling up. */
export async function claimNextImportJob(
  db: Database,
): Promise<ImportJob | null> {
  const [job] = await db
    .update(importJobs)
    .set({
      status: "running",
      attempts: sql`${importJobs.attempts} + 1`,
      lockedAt: sql`now()`,
    })
    .where(
      sql`${importJobs.id} = (
        select id from import_jobs
        where status = 'queued' and run_after <= now()
        order by created_at
        for update skip locked
        limit 1)`,
    )
    .returning();
  return job ?? null;
}

// Writes below are fenced on the claim that owns the job (status running + attempts = the
// value returned when it was claimed), so a worker that lost its claim can't touch the row.
const owned = (id: string, claimAttempts: number) =>
  and(
    eq(importJobs.id, id),
    eq(importJobs.status, "running"),
    eq(importJobs.attempts, claimAttempts),
  );

export async function setImportStage(
  db: Database,
  id: string,
  claimAttempts: number,
  stage: ImportStage,
): Promise<void> {
  await db.update(importJobs).set({ stage }).where(owned(id, claimAttempts));
}

/** Drops the uploaded file and keeps the extracted text, so a retry can resume from the text. */
export async function clearImportFile(
  db: Database,
  id: string,
  claimAttempts: number,
  sourceText: string,
): Promise<void> {
  await db
    .update(importJobs)
    .set({ fileBytes: null, sourceText })
    .where(owned(id, claimAttempts));
}

export async function completeImportJob(
  db: Database,
  id: string,
  claimAttempts: number,
  done: {
    result: unknown;
    contentHash?: string;
    pipelineVersion?: string;
  },
): Promise<boolean> {
  const rows = await db
    .update(importJobs)
    .set({
      status: "done",
      stage: "done",
      result: done.result,
      sourceText: null, // the resume text is only kept until the job ends
      contentHash: done.contentHash ?? null,
      pipelineVersion: done.pipelineVersion ?? null,
      fileBytes: null,
      errorCode: null,
      finishedAt: sql`now()`,
    })
    .where(owned(id, claimAttempts))
    .returning({ id: importJobs.id });
  return rows.length > 0;
}

/** Retryable failures go back in the queue with exponential backoff (5 s, 10 s, ... with jitter). */
export async function failImportJob(
  db: Database,
  id: string,
  claimAttempts: number,
  fail: { errorCode: string; retryable: boolean },
): Promise<"requeued" | "failed" | "lost"> {
  const res = await db.execute<{ status: string }>(sql`
    update import_jobs set
      status = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then 'queued' else 'failed' end,
      stage = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then 'queued' else 'failed' end,
      locked_at = null,
      run_after = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS}
        then now() + make_interval(secs => 5 * power(2, greatest(attempts - 1, 0)) * (0.8 + random() * 0.4))
        else run_after end,
      error_code = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then error_code else ${fail.errorCode} end,
      file_bytes = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then file_bytes else null end,
      source_text = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then source_text else null end,
      finished_at = case when ${fail.retryable} and attempts < ${MAX_JOB_ATTEMPTS} then null else now() end
    where id = ${id} and status = 'running' and attempts = ${claimAttempts}
    returning status`);
  const status = res.rows[0]?.status;
  if (!status) return "lost";
  return status === "queued" ? "requeued" : "failed";
}

/** Rescues jobs whose worker died: re-queue them, or fail them with TIMEOUT once attempts run out. */
export async function requeueStaleImportJobs(
  db: Database,
  olderThanMs = 120_000,
): Promise<number> {
  const res = await db.execute(sql`
    update import_jobs set
      status = case when attempts < ${MAX_JOB_ATTEMPTS} then 'queued' else 'failed' end,
      stage = case when attempts < ${MAX_JOB_ATTEMPTS} then 'queued' else 'failed' end,
      locked_at = null,
      error_code = case when attempts < ${MAX_JOB_ATTEMPTS} then error_code else 'TIMEOUT' end,
      file_bytes = case when attempts < ${MAX_JOB_ATTEMPTS} then file_bytes else null end,
      source_text = case when attempts < ${MAX_JOB_ATTEMPTS} then source_text else null end,
      finished_at = case when attempts < ${MAX_JOB_ATTEMPTS} then null else now() end
    where status = 'running'
      and locked_at < now() - make_interval(secs => ${olderThanMs / 1000})`);
  return res.rowCount ?? 0;
}

export async function findCachedResumeResult(
  db: Database,
  contentHash: string,
  pipelineVersion: string,
): Promise<unknown | null> {
  const [row] = await db
    .select({ result: importJobs.result })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.status, "done"),
        eq(importJobs.contentHash, contentHash),
        eq(importJobs.pipelineVersion, pipelineVersion),
      ),
    )
    .orderBy(desc(importJobs.finishedAt))
    .limit(1);
  return row?.result ?? null;
}

// Never selects file_bytes or source_text: those stay out of API responses.
const publicColumns = {
  id: importJobs.id,
  userId: importJobs.userId,
  kind: importJobs.kind,
  status: importJobs.status,
  stage: importJobs.stage,
  fileType: importJobs.fileType,
  input: importJobs.input,
  contentHash: importJobs.contentHash,
  pipelineVersion: importJobs.pipelineVersion,
  result: importJobs.result,
  errorCode: importJobs.errorCode,
  attempts: importJobs.attempts,
  runAfter: importJobs.runAfter,
  lockedAt: importJobs.lockedAt,
  createdAt: importJobs.createdAt,
  finishedAt: importJobs.finishedAt,
};
type PublicImportJob = Omit<ImportJob, "fileBytes" | "sourceText">;

export async function latestImportJobs(
  db: Database,
  userId: string,
): Promise<{ resume: PublicImportJob | null; github: PublicImportJob | null }> {
  const latest = async (kind: ImportKind) => {
    const [row] = await db
      .select(publicColumns)
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), eq(importJobs.kind, kind)))
      .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
      .limit(1);
    return row ?? null;
  };
  const [resume, github] = await Promise.all([
    latest("resume"),
    latest("github"),
  ]);
  return { resume, github };
}

export async function recordLlmUsage(
  db: Database,
  row: typeof llmUsage.$inferInsert,
): Promise<void> {
  await db.insert(llmUsage).values(row);
}
