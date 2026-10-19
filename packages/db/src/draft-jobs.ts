// The drafts job queue (docs/drafts/README.md §9, §10): creating a draft job charges
// credits in the same transaction; the worker claims, completes or fails it (Phase 7).
import {
  DAILY_COST_CAP_MICROS,
  DAILY_CREDIT_CAP,
  type EvalCandidateReason,
  type RewriteOption,
} from "@redlance/core";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  costTodayMicros,
  creditsUsedToday,
  lockCreditBalance,
  refundCredits,
  reserveCredits,
  type MoneyExecutor,
  type MoneyTx,
} from "./credits";
import { draftEvalCandidates, drafts, type Draft } from "./schema";

export const DRAFTS_CHANNEL = "drafts";

export type CreateDraftJobInput = {
  userId: string;
  matchId: string;
  jobPostId: string;
  version: number;
  parentId?: string | null;
  kind: "draft" | "rewrite";
  option?: RewriteOption | null;
  instruction?: string | null;
  /** Credits to reserve (core TASK_CREDITS). */
  credits: number;
  idempotencyKey: string;
  evidence?: Record<string, unknown> | null;
};

export type CreateDraftJobResult =
  | { draft: Draft; created: boolean }
  | { error: "daily_limit" | "insufficient" };

/** Thrown inside the transaction to roll it back with a result. */
class Abort {
  constructor(readonly result: CreateDraftJobResult) {}
}

/**
 * Queues a draft and reserves its credits, all in one transaction. The user's
 * credit_balances row is locked first, so two requests from one user run one after the
 * other: the cap checks and the reserve can't interleave, and an idempotency key or a
 * (user, match, version) already used returns that draft without a second charge.
 * NOTIFY `drafts` is delivered when the transaction commits.
 */
export async function createDraftJob(
  db: MoneyExecutor,
  job: CreateDraftJobInput,
  now: Date = new Date(),
): Promise<CreateDraftJobResult> {
  if (!Number.isInteger(job.credits) || job.credits < 1) {
    throw new Error("credits must be a positive integer");
  }
  try {
    return await db.transaction(async (tx) => {
      const balance = await lockCreditBalance(tx, job.userId);

      const existing = await findExisting(tx, job);
      if (existing) return { draft: existing, created: false };

      if (!balance) return { error: "insufficient" };
      const used = await creditsUsedToday(tx, job.userId, now);
      if (used + job.credits > DAILY_CREDIT_CAP[balance.plan]) {
        return { error: "daily_limit" };
      }
      const cost = await costTodayMicros(tx, job.userId, now);
      if (cost >= DAILY_COST_CAP_MICROS[balance.plan]) {
        return { error: "daily_limit" };
      }
      // Checked here (under the lock) so the common refusal writes nothing; the guarded
      // UPDATE in reserveCredits stays the real guard.
      if (
        balance.balance < job.credits ||
        balance.periodEnd.getTime() <= Date.now()
      ) {
        return { error: "insufficient" };
      }

      const [draft] = await tx
        .insert(drafts)
        .values({
          userId: job.userId,
          matchId: job.matchId,
          jobPostId: job.jobPostId,
          version: job.version,
          parentId: job.parentId ?? null,
          kind: job.kind,
          option: job.option ?? null,
          instruction: job.instruction ?? null,
          credits: job.credits,
          idempotencyKey: job.idempotencyKey,
          evidence: job.evidence ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!draft) {
        // Unreachable while the lock is held; kept as a guard.
        const again = await findExisting(tx, job);
        if (again) return { draft: again, created: false };
        throw new Error("draft insert conflicted but no existing draft found");
      }

      const reserved = await reserveCredits(tx, {
        userId: job.userId,
        amount: job.credits,
        draftId: draft.id,
      });
      if (!reserved.ok) throw new Abort({ error: "insufficient" });

      await tx.execute(sql`select pg_notify(${DRAFTS_CHANNEL}, ${draft.id})`);
      return { draft, created: true };
    });
  } catch (err) {
    if (err instanceof Abort) return err.result;
    throw err;
  }
}

/**
 * The draft this request already made: same idempotency key, or same (user, match, version)
 * among the versions that didn't fail (a failed version frees its number).
 */
async function findExisting(
  tx: MoneyTx,
  job: CreateDraftJobInput,
): Promise<Draft | null> {
  const [byKey] = await tx
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, job.userId),
        eq(drafts.idempotencyKey, job.idempotencyKey),
      ),
    );
  if (byKey) return byKey;
  const [byVersion] = await tx
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, job.userId),
        eq(drafts.matchId, job.matchId),
        eq(drafts.version, job.version),
        ne(drafts.status, "failed"),
      ),
    );
  return byVersion ?? null;
}

// ---- The worker's side (Phase 7) ----
//
// Same shape as the post-analysis queue: claims take rows with FOR UPDATE SKIP LOCKED and
// count the attempt; every later write is fenced on (status = 'running', attempts = the
// claim's attempts), so a claim that was swept and taken again by another worker can't
// overwrite the newer run. A final failure refunds in the same transaction as the status
// change, and refundCredits' unique index makes a second refund a no-op.

/** Claims (counted attempts) before a retryable failure becomes final. */
export const MAX_DRAFT_ATTEMPTS = 3;

/** A claimed draft: the row as it was claimed (`attempts` fences later writes). */
export type DraftClaim = Draft;

/** Takes up to `limit` due pending drafts, oldest first. `now` defaults to the database clock. */
export async function claimNextDrafts(
  db: Database,
  limit: number,
  now?: Date,
): Promise<DraftClaim[]> {
  if (limit <= 0) return [];
  const due = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const res = await db.execute<{ id: string }>(sql`
    update drafts set
      status = 'running',
      attempts = attempts + 1,
      locked_at = now()
    where id in (
      select id from drafts
      where status = 'pending' and run_after <= ${due}
      order by created_at, id
      limit ${limit}
      for update skip locked)
    returning id`);
  const ids = res.rows.map((r) => r.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(drafts)
    .where(inArray(drafts.id, ids))
    .orderBy(asc(drafts.createdAt), asc(drafts.id));
}

const owned = (claim: Pick<DraftClaim, "id" | "attempts">) =>
  and(
    eq(drafts.id, claim.id),
    eq(drafts.status, "running"),
    eq(drafts.attempts, claim.attempts),
  );

/** What a finished draft saves. Only the two texts are required. */
export type CompleteDraftInput = {
  comment: string;
  dm: string;
  problem?: string | null;
  citedFact?: string | null;
  /** Whether the draft follows the post's how-to-apply instructions; null when it had none. */
  applyFollowed?: boolean | null;
  evidence?: Record<string, unknown> | null;
  styleTags?: string[];
  warning?: boolean;
  problems?: { code: string; detail?: string }[];
  model?: string | null;
  promptVersion?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costMicros?: number | null;
  timings?: Record<string, number> | null;
};

/** Saves the draft and marks it done (the reserved credits are kept). False if the claim was lost. */
export async function completeDraft(
  db: Pick<Database, "update">,
  claim: Pick<DraftClaim, "id" | "attempts">,
  result: CompleteDraftInput,
): Promise<boolean> {
  const rows = await db
    .update(drafts)
    .set({
      status: "done",
      lockedAt: null,
      error: null,
      comment: result.comment,
      dm: result.dm,
      problem: result.problem ?? null,
      citedFact: result.citedFact ?? null,
      applyFollowed: result.applyFollowed ?? null,
      ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
      styleTags: result.styleTags ?? [],
      warning: result.warning ?? false,
      problems: result.problems ?? [],
      model: result.model ?? null,
      promptVersion: result.promptVersion ?? null,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      costMicros: result.costMicros ?? null,
      timings: result.timings ?? null,
      finishedAt: sql`now()`,
    })
    .where(owned(claim))
    .returning({ id: drafts.id });
  return rows.length > 0;
}

export type DraftFailure = {
  /** An error code only, never text from the model or the post. */
  code: string;
  retryable: boolean;
  /** false = not the draft's fault (provider outage, shutdown): the attempt is given back. */
  countAttempt: boolean;
  /** Delay before the retry; defaults to 2^attempts seconds. */
  retryInSec?: number;
};

/**
 * Retryable failures go back to pending (with backoff) while attempts remain; a failure that
 * doesn't count goes back always. Anything else is final: `failed` plus a refund, in one
 * transaction that locks the user's balance first (the same order as createDraftJob).
 */
export async function failDraft(
  db: MoneyExecutor,
  claim: Pick<DraftClaim, "id" | "attempts" | "userId">,
  fail: DraftFailure,
): Promise<"requeued" | "failed" | "lost"> {
  const giveBack = fail.retryable && !fail.countAttempt;
  const retry =
    fail.retryable && (giveBack || claim.attempts < MAX_DRAFT_ATTEMPTS);
  const delay = Math.max(0, fail.retryInSec ?? 2 ** claim.attempts);
  return db.transaction(async (tx) => {
    await lockCreditBalance(tx, claim.userId);
    const rows = await tx
      .update(drafts)
      .set(
        retry
          ? {
              status: "pending",
              attempts: giveBack
                ? sql`greatest(${drafts.attempts} - 1, 0)`
                : drafts.attempts,
              lockedAt: null,
              error: fail.code,
              runAfter: sql`now() + make_interval(secs => ${delay})`,
            }
          : {
              status: "failed",
              lockedAt: null,
              error: fail.code,
              finishedAt: sql`now()`,
            },
      )
      .where(owned(claim))
      .returning({ id: drafts.id });
    if (rows.length === 0) return "lost";
    if (retry) return "requeued";
    await refundCredits(tx, { userId: claim.userId, draftId: claim.id });
    return "failed";
  });
}

/**
 * Rescues drafts whose worker died mid-run: back to pending while attempts remain, else
 * failed (`STALE`) and refunded. Returns how many it moved.
 */
export async function requeueStaleDrafts(
  db: Database,
  olderThanSec = 60,
): Promise<number> {
  const stale = sql`${drafts.status} = 'running' and ${drafts.lockedAt} < now() - make_interval(secs => ${olderThanSec})`;
  const back = await db
    .update(drafts)
    .set({ status: "pending", lockedAt: null, runAfter: sql`now()` })
    .where(sql`${stale} and ${drafts.attempts} < ${MAX_DRAFT_ATTEMPTS}`)
    .returning({ id: drafts.id });
  // Out of attempts: one money transaction each, balance locked before the draft row.
  const spent = await db
    .select({ id: drafts.id, userId: drafts.userId })
    .from(drafts)
    .where(sql`${stale} and ${drafts.attempts} >= ${MAX_DRAFT_ATTEMPTS}`);
  let failed = 0;
  for (const d of spent) {
    const done = await db.transaction(async (tx) => {
      await lockCreditBalance(tx, d.userId);
      const rows = await tx
        .update(drafts)
        .set({
          status: "failed",
          lockedAt: null,
          error: "STALE",
          finishedAt: sql`now()`,
        })
        .where(
          sql`${drafts.id} = ${d.id} and ${stale} and ${drafts.attempts} >= ${MAX_DRAFT_ATTEMPTS}`,
        )
        .returning({ id: drafts.id });
      if (rows.length === 0) return false;
      await refundCredits(tx, { userId: d.userId, draftId: d.id });
      return true;
    });
    if (done) failed++;
  }
  return back.length + failed;
}

/** A draft still pending or running this long after it was made is given up on (M4). */
export const DRAFT_EXPIRE_AFTER_SEC = 10 * 60;

/**
 * Gives up on drafts that are still pending or running `olderThanSec` after they were made
 * (the worker is off, a long provider outage, the budget pause): `failed` with code
 * `EXPIRED` and refunded. Same order as failDraft: the user's balance is locked first, then
 * the guarded status change, then the refund, so two expiries at once refund once (and the
 * refund-once index is a second guard). The web calls it for one draft (`draftId`) so a
 * stopped worker doesn't hold the user's credits. Returns how many it expired.
 */
export async function expireStuckDrafts(
  db: Database,
  opts: { olderThanSec?: number; draftId?: string } = {},
): Promise<number> {
  const age = opts.olderThanSec ?? DRAFT_EXPIRE_AFTER_SEC;
  const stuck = sql`${drafts.status} in ('pending', 'running') and ${drafts.createdAt} < now() - make_interval(secs => ${age})`;
  const only = opts.draftId ? sql` and ${drafts.id} = ${opts.draftId}` : sql``;
  const found = await db
    .select({ id: drafts.id, userId: drafts.userId })
    .from(drafts)
    .where(sql`${stuck}${only}`)
    .orderBy(asc(drafts.createdAt))
    .limit(500);
  let expired = 0;
  for (const d of found) {
    const done = await db.transaction(async (tx) => {
      await lockCreditBalance(tx, d.userId);
      const rows = await tx
        .update(drafts)
        .set({
          status: "failed",
          lockedAt: null,
          error: "EXPIRED",
          finishedAt: sql`now()`,
        })
        .where(sql`${drafts.id} = ${d.id} and ${stuck}`)
        .returning({ id: drafts.id });
      if (rows.length === 0) return false;
      await refundCredits(tx, { userId: d.userId, draftId: d.id });
      return true;
    });
    if (done) expired++;
  }
  return expired;
}

/** Marks a draft for a human look in the eval review queue (once per draft and reason). */
export async function addEvalCandidate(
  db: Pick<Database, "insert">,
  draftId: string,
  reason: EvalCandidateReason,
): Promise<void> {
  await db
    .insert(draftEvalCandidates)
    .values({ draftId, reason })
    .onConflictDoNothing();
}

/** Every version of the user's draft for one match, in version order (rewrites read their parent). */
export async function draftVersions(
  db: Pick<Database, "select">,
  opts: { userId: string; matchId: string },
): Promise<
  Pick<
    Draft,
    "id" | "version" | "status" | "parentId" | "comment" | "dm" | "evidence"
  >[]
> {
  return db
    .select({
      id: drafts.id,
      version: drafts.version,
      status: drafts.status,
      parentId: drafts.parentId,
      comment: drafts.comment,
      dm: drafts.dm,
      evidence: drafts.evidence,
    })
    .from(drafts)
    .where(
      and(eq(drafts.userId, opts.userId), eq(drafts.matchId, opts.matchId)),
    )
    .orderBy(asc(drafts.version));
}
