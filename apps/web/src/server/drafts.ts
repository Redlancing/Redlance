import "server-only";
import {
  DAILY_CREDIT_CAP,
  MAX_VERSIONS,
  TASK_CREDITS,
  aiAllowed,
  draftRedFlags,
  repliesLeft,
  taskForRewrite,
  type RewriteOption,
} from "@redlance/core";
import {
  DRAFT_EXPIRE_AFTER_SEC,
  createDraftJob,
  creditsUsedToday,
  draftEvalCandidates,
  draftFeedback,
  draftVersions,
  drafts,
  evidenceForDraft,
  expireStuckDrafts,
  getCredits,
  isDraftingPaused,
  jobPostAnalyses,
  loadDraftContext,
  matches,
  profiles,
  type CreateDraftJobResult,
  type Draft,
} from "@redlance/db";
import { and, asc, eq, isNull, max, ne } from "drizzle-orm";
import { getDb } from "./db";
import { getEnv } from "./env";
import { ApiError } from "./errors";
import { getRateLimiter, hourlyDraftWarning } from "./rate-limit";

type UserRef = { userId: string };

/** What the browser sees of a draft. Never the evidence text, the prompt or validator details. */
export type DraftView = {
  id: string;
  matchId: string;
  status: Draft["status"];
  version: number;
  kind: Draft["kind"];
  option: Draft["option"];
  instruction: string | null;
  comment: string | null;
  dm: string | null;
  warning: boolean;
  /** Validator codes only. */
  problems: { code: string }[];
  evidenceSummary: {
    projectTitle: string | null;
    roleTitle: string | null;
    skills: string[];
  } | null;
  applyInstructions: string | null;
  redFlags: string[];
  creditsCharged: number;
  /** An error code when status is failed. */
  error: string | null;
  createdAt: string;
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function summaryOf(evidence: Record<string, unknown> | null) {
  const s = evidence?.summary as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return null;
  return {
    projectTitle: typeof s.projectTitle === "string" ? s.projectTitle : null,
    roleTitle: typeof s.roleTitle === "string" ? s.roleTitle : null,
    skills: strings(s.skills),
  };
}

type AnalysisView = {
  applyInstructions: string | null;
  redFlags: string[];
  payType: string;
};

function toView(d: Draft, analysis: AnalysisView | null): DraftView {
  const done = d.status === "done";
  const evidence = d.evidence as Record<string, unknown> | null;
  return {
    id: d.id,
    matchId: d.matchId,
    status: d.status,
    version: d.version,
    kind: d.kind,
    option: d.option,
    instruction: d.instruction,
    comment: done ? d.comment : null,
    dm: done ? d.dm : null,
    warning: d.warning,
    problems: (d.problems ?? []).map((p) => ({ code: p.code })),
    evidenceSummary: summaryOf(evidence),
    applyInstructions: analysis?.applyInstructions ?? null,
    // From the post's analysis for every status, so pending and done agree.
    redFlags: analysis ? draftRedFlags(analysis) : [],
    creditsCharged: d.credits,
    error: d.status === "failed" ? d.error : null,
    createdAt: d.createdAt.toISOString(),
  };
}

async function analysisFor(jobPostId: string) {
  const [a] = await getDb()
    .select({
      applyInstructions: jobPostAnalyses.applyInstructions,
      redFlags: jobPostAnalyses.redFlags,
      payType: jobPostAnalyses.payType,
    })
    .from(jobPostAnalyses)
    .where(eq(jobPostAnalyses.jobPostId, jobPostId));
  return a ?? null;
}

async function requireAi(userId: string): Promise<void> {
  const [p] = await getDb()
    .select({ plan: profiles.plan, trialEndsAt: profiles.trialEndsAt })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!p) throw new ApiError("FORBIDDEN", "Finish onboarding first.");
  if (!aiAllowed(p.plan, p.trialEndsAt, new Date()))
    throw new ApiError("PLAN_EXPIRED", "Your trial has ended.");
}

async function requireNotPaused(): Promise<void> {
  if (await isDraftingPaused(getDb(), getEnv(), new Date()))
    throw new ApiError(
      "UNAVAILABLE",
      "Drafting is paused for now. Try again later.",
    );
}

async function draftByKey(userId: string, key: string): Promise<Draft | null> {
  const [d] = await getDb()
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.idempotencyKey, key)));
  return d ?? null;
}

/**
 * A pending or running draft older than DRAFT_EXPIRE_AFTER_SEC is given up on (failed
 * EXPIRED, refunded once) so a stopped worker doesn't hold the user's credits. Returns the
 * draft as it is now.
 */
async function expireIfStuck(d: Draft): Promise<Draft> {
  if (d.status !== "pending" && d.status !== "running") return d;
  if (Date.now() - d.createdAt.getTime() < DRAFT_EXPIRE_AFTER_SEC * 1000)
    return d;
  await expireStuckDrafts(getDb(), { draftId: d.id });
  const [now] = await getDb().select().from(drafts).where(eq(drafts.id, d.id));
  return now ?? d;
}

function failed(r: Extract<CreateDraftJobResult, { error: string }>): ApiError {
  return r.error === "daily_limit"
    ? new ApiError(
        "DAILY_LIMIT",
        "Daily draft limit reached. Try again tomorrow.",
      )
    : new ApiError("INSUFFICIENT_CREDITS", "Not enough credits.");
}

export async function startDraft(
  user: UserRef,
  input: { matchId: string; idempotencyKey: string },
): Promise<{
  draftId: string;
  status: Draft["status"];
  created: boolean;
  slowDown: boolean;
}> {
  const db = getDb();
  await requireAi(user.userId);

  const [match] = await db
    .select({ id: matches.id, jobPostId: matches.jobPostId })
    .from(matches)
    .where(
      and(
        eq(matches.id, input.matchId),
        eq(matches.userId, user.userId),
        isNull(matches.withdrawnAt),
      ),
    );
  if (!match) throw new ApiError("NOT_FOUND", "Match not found.");

  // The same key may only ever mean the same match.
  const keyed = await draftByKey(user.userId, input.idempotencyKey);
  if (keyed && keyed.matchId !== match.id)
    throw new ApiError(
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key was used for a different request.",
    );

  // A replay of a stuck request: expire it first, so the replay reports it failed.
  if (keyed) await expireIfStuck(keyed);

  // The current v1 (a failed one doesn't count: a new key makes a new draft). One stuck for
  // over 10 minutes is expired and refunded, then replaced.
  const [found] = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, user.userId),
        eq(drafts.matchId, match.id),
        eq(drafts.version, 1),
        ne(drafts.status, "failed"),
      ),
    );
  const v1 = found ? await expireIfStuck(found) : undefined;
  if (v1 && v1.status !== "failed")
    return {
      draftId: v1.id,
      status: v1.status,
      created: false,
      slowDown: false,
    };

  await requireNotPaused();

  const result = await createDraftJob(db, {
    userId: user.userId,
    matchId: match.id,
    jobPostId: match.jobPostId,
    version: 1,
    kind: "draft",
    credits: TASK_CREDITS.draft,
    idempotencyKey: input.idempotencyKey,
  });
  if ("error" in result) throw failed(result);
  if (result.draft.matchId !== match.id)
    throw new ApiError(
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key was used for a different request.",
    );

  const slowDown = result.created
    ? (await hourlyDraftWarning(getRateLimiter(), user.userId)).slowDown
    : false;
  return {
    draftId: result.draft.id,
    status: result.draft.status,
    created: result.created,
    slowDown,
  };
}

export type RewriteInput =
  | { option: Exclude<RewriteOption, "custom">; instruction?: undefined }
  | { option?: undefined; instruction: string };

export async function startRewrite(
  user: UserRef,
  draftId: string,
  input: RewriteInput & { idempotencyKey: string },
): Promise<{ draftId: string; status: Draft["status"]; version: number }> {
  const db = getDb();
  await requireAi(user.userId);

  const [parent] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, user.userId)));
  if (!parent) throw new ApiError("NOT_FOUND", "Draft not found.");

  // A replay returns the rewrite it made, even once that rewrite filled the last version.
  const keyed = await draftByKey(user.userId, input.idempotencyKey);
  if (keyed) {
    if (keyed.parentId !== parent.id)
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key was used for a different request.",
      );
    return { draftId: keyed.id, status: keyed.status, version: keyed.version };
  }

  const [match] = await db
    .select({ withdrawnAt: matches.withdrawnAt })
    .from(matches)
    .where(
      and(eq(matches.id, parent.matchId), eq(matches.userId, user.userId)),
    );
  if (!match || match.withdrawnAt)
    throw new ApiError(
      "MATCH_WITHDRAWN",
      "This post is no longer in your feed, so it can't be rewritten.",
    );

  if (parent.status !== "done")
    throw new ApiError("DRAFT_NOT_READY", "This draft isn't ready yet.");

  // Failed versions free their number and don't count toward MAX_VERSIONS.
  const [top] = await db
    .select({ v: max(drafts.version) })
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, user.userId),
        eq(drafts.matchId, parent.matchId),
        ne(drafts.status, "failed"),
      ),
    );
  const version = (top?.v ?? parent.version) + 1;
  if (version > MAX_VERSIONS)
    throw new ApiError(
      "MAX_VERSIONS",
      `You can keep up to ${MAX_VERSIONS} versions of a draft.`,
    );

  const option: RewriteOption = input.option ?? "custom";
  // "Different project" with no project left to cite: refused here, before any charge
  // (the worker makes the same check from the same code).
  if (option === "different_project") {
    const ctx = await loadDraftContext(db, {
      userId: user.userId,
      matchId: parent.matchId,
    });
    if (!ctx)
      throw new ApiError(
        "MATCH_WITHDRAWN",
        "This post is no longer in your feed, so it can't be rewritten.",
      );
    const versions = await draftVersions(db, {
      userId: user.userId,
      matchId: parent.matchId,
    });
    const built = evidenceForDraft(
      ctx,
      { kind: "rewrite", option, version, parentEvidence: parent.evidence },
      versions,
      new Date(),
    );
    if ("stop" in built)
      throw new ApiError(
        "NO_OTHER_PROJECT",
        "There's no other project on your profile to cite for this post.",
      );
  }

  await requireNotPaused();

  const result = await createDraftJob(db, {
    userId: user.userId,
    matchId: parent.matchId,
    jobPostId: parent.jobPostId,
    version,
    parentId: parent.id,
    kind: "rewrite",
    option,
    instruction: input.instruction ?? null,
    credits: TASK_CREDITS[taskForRewrite(option)],
    idempotencyKey: input.idempotencyKey,
  });
  if ("error" in result) throw failed(result);
  // Another rewrite took this version first (a second tab): nothing was charged.
  if (result.draft.idempotencyKey !== input.idempotencyKey)
    throw new ApiError(
      "VERSION_CONFLICT",
      "Another rewrite is already running.",
    );
  return {
    draftId: result.draft.id,
    status: result.draft.status,
    version: result.draft.version,
  };
}

export async function getDraft(user: UserRef, id: string): Promise<DraftView> {
  const [d] = await getDb()
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.userId, user.userId)));
  if (!d) throw new ApiError("NOT_FOUND", "Draft not found.");
  return toView(await expireIfStuck(d), await analysisFor(d.jobPostId));
}

/**
 * The user's draft versions for a match, v1 first. Failed versions are left out (they free
 * their number, so a retry can share it); a failed draft is still readable by id. Empty for
 * someone else's match.
 */
export async function listVersions(
  user: UserRef,
  matchId: string,
): Promise<DraftView[]> {
  const rows = await getDb()
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, user.userId),
        eq(drafts.matchId, matchId),
        ne(drafts.status, "failed"),
      ),
    )
    .orderBy(asc(drafts.version), asc(drafts.createdAt));
  if (rows.length === 0) return [];
  const analysis = await analysisFor(rows[0]!.jobPostId);
  return rows.map((d) => toView(d, analysis));
}

/** A thumbs-down: one feedback row per user and draft, and an eval candidate. */
export async function saveFeedback(
  user: UserRef,
  draftId: string,
  reason: string | null,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [d] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.id, draftId), eq(drafts.userId, user.userId)));
    if (!d) throw new ApiError("NOT_FOUND", "Draft not found.");
    await tx
      .insert(draftFeedback)
      .values({ userId: user.userId, draftId, reason })
      .onConflictDoUpdate({
        target: [draftFeedback.userId, draftFeedback.draftId],
        set: { reason },
      });
    await tx
      .insert(draftEvalCandidates)
      .values({ draftId, reason: "thumbs_down" })
      .onConflictDoNothing();
  });
}

export async function creditsSummary(user: UserRef) {
  const db = getDb();
  const now = new Date();
  const c = await getCredits(db, user.userId);
  if (!c)
    return {
      plan: null,
      balance: 0,
      periodEnd: null,
      repliesLeft: 0,
      usedToday: 0,
      dailyCap: 0,
    };
  return {
    plan: c.plan,
    balance: c.balance,
    periodEnd: c.periodEnd.toISOString(),
    repliesLeft:
      c.periodEnd.getTime() > now.getTime() ? repliesLeft(c.balance) : 0,
    usedToday: await creditsUsedToday(db, user.userId, now),
    dailyCap: DAILY_CREDIT_CAP[c.plan],
  };
}
