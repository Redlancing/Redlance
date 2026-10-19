import "server-only";
import {
  checkGithubInput,
  suggestionsSchema,
  type ResumeStepName,
  type StepId,
  type Suggestions,
} from "@redlance/core";
import {
  enqueueImportJob,
  importJobs,
  onboardingSteps,
  profiles,
  users,
  type ImportJob,
  type ImportKind,
  type ImportStage,
} from "@redlance/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { ApiError } from "../errors";
import { readBody } from "../http";
import { getRateLimiter } from "../rate-limit";

export type ImportSummary = {
  id: string;
  kind: "resume" | "github";
  status: "queued" | "running" | "done" | "failed";
  stage: ImportStage;
  errorCode: string | null;
  suggestions: Suggestions | null;
  partial: ResumeStepName[];
  /** Steps the pipeline didn't run because the resume had no section for them. */
  skipped: ResumeStepName[];
  /** A GitHub import the worker started from a link in the resume. */
  fromResume?: boolean;
  createdAt: string;
};

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MULTIPART_OVERHEAD = 64 * 1024;
export const RESUME_QUOTA_PER_DAY = 5;
export const GITHUB_QUOTA_PER_DAY = 10;

/** Magic bytes only; the web server never parses the file. */
export function sniffFileType(bytes: Uint8Array): "pdf" | "docx" | null {
  const startsWith = (sig: number[]) =>
    bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return "docx"; // PK\x03\x04
  return null;
}

export function toImportSummary(
  job: Omit<ImportJob, "fileBytes" | "sourceText">,
): ImportSummary {
  const parsed = suggestionsSchema.safeParse(job.result);
  const suggestions = parsed.success ? parsed.data : null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stage: job.stage,
    errorCode: job.errorCode,
    suggestions,
    partial: suggestions?.meta?.partial ?? [],
    skipped: suggestions?.meta?.skipped ?? [],
    fromResume:
      (job.input as { fromResume?: unknown } | null)?.fromResume === true,
    createdAt: job.createdAt.toISOString(),
  };
}

async function assertNotOnboarded(userId: string): Promise<void> {
  const [profile] = await getDb()
    .select({ onboardedAt: profiles.onboardedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (profile?.onboardedAt)
    throw new ApiError("ALREADY_ONBOARDED", "Your profile is already set up.");
}

async function takeQuota(userId: string, name: string, limit: number) {
  const q = await getRateLimiter().consumeQuota(`u:${userId}`, name, limit);
  if (!q.allowed)
    throw new ApiError(
      "QUOTA_EXCEEDED",
      "You've reached today's import limit. Try again tomorrow.",
    );
}

const tooLarge = () =>
  new ApiError("PAYLOAD_TOO_LARGE", "That file is over 5 MB.");

export async function startResumeImport(
  userId: string,
  request: Request,
): Promise<{ jobId: string }> {
  await assertNotOnboarded(userId);

  const declared = request.headers.get("content-length");
  if (declared === null)
    throw new ApiError("LENGTH_REQUIRED", "Content-Length is required.");
  const declaredSize = Number(declared);
  if (!Number.isFinite(declaredSize) || declaredSize < 0)
    throw new ApiError("INVALID_INPUT", "Invalid Content-Length.");
  if (declaredSize > MAX_RESUME_BYTES + MULTIPART_OVERHEAD) throw tooLarge();

  // Read the real bytes with a cap (Content-Length can lie), then parse the multipart body.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data"))
    throw new ApiError(
      "INVALID_INPUT",
      "Send the file as multipart/form-data.",
    );
  const body = await readBody(request, MAX_RESUME_BYTES + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(body),
    }).formData();
  } catch {
    throw new ApiError("INVALID_INPUT", "Couldn't read the upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File))
    throw new ApiError(
      "INVALID_INPUT",
      "Attach your resume as the file field.",
    );
  if (file.size === 0)
    throw new ApiError("INVALID_INPUT", "That file is empty.");
  if (file.size > MAX_RESUME_BYTES) throw tooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileType = sniffFileType(bytes);
  if (!fileType)
    throw new ApiError(
      "UNSUPPORTED_FILE",
      "Upload a PDF or Word (.docx) file.",
    );

  await takeQuota(userId, "resume_import", RESUME_QUOTA_PER_DAY);
  // The file name is deliberately not stored.
  const jobId = await enqueueImportJob(getDb(), {
    userId,
    kind: "resume",
    input: { size: bytes.length },
    fileBytes: bytes,
    fileType,
  });
  return { jobId };
}

export async function startGithubImport(
  userId: string,
  rawUsername: string,
): Promise<{ jobId: string }> {
  const check = checkGithubInput(rawUsername);
  if (!check.ok) throw new ApiError("INVALID_INPUT", check.message);
  if (!check.username)
    throw new ApiError("INVALID_INPUT", "Enter your GitHub username.");
  await assertNotOnboarded(userId);
  await takeQuota(userId, "github_import", GITHUB_QUOTA_PER_DAY);
  const jobId = await enqueueImportJob(getDb(), {
    userId,
    kind: "github",
    input: { username: check.username },
  });
  return { jobId };
}

export async function getImport(
  userId: string,
  id: string,
): Promise<ImportSummary> {
  const [job] = await getDb()
    .select({
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
    })
    .from(importJobs)
    .where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)));
  if (!job) throw new ApiError("NOT_FOUND", "Not found.");
  return toImportSummary(job);
}

/**
 * Clears the steps a fresh import pre-fills again: Basics and Skills always, Projects &
 * experience only when a resume import was accepted (GitHub never fills it).
 */
export async function resetForReimport(
  userId: string,
  kinds: readonly ImportKind[],
): Promise<void> {
  const steps: StepId[] = ["basics", "skills"];
  if (kinds.includes("resume")) steps.push("work");
  await getDb().transaction(async (tx) => {
    // FOR SHARE conflicts with Finish's FOR UPDATE, same as saveStep.
    const [locked] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("share");
    if (!locked) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
    const [profile] = await tx
      .select({ onboardedAt: profiles.onboardedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (profile?.onboardedAt)
      throw new ApiError(
        "ALREADY_ONBOARDED",
        "Your profile is already set up.",
      );
    await tx
      .delete(onboardingSteps)
      .where(
        and(
          eq(onboardingSteps.userId, userId),
          inArray(onboardingSteps.step, steps),
        ),
      );
  });
}
