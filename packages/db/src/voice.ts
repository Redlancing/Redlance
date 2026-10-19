// Voice learning storage (docs/drafts/README.md §11, plan/09-voice.md). Every send updates the
// user's running stats; now and then it queues a voice-notes rewrite on the same row
// (`update_*` columns), which the worker claims like a draft: SKIP LOCKED, writes fenced on
// the claim, a stale sweep. There's no attempts column: a failure that is the job's own goes
// back to idle and the next qualifying send queues it again.
import {
  shouldUpdateVoice,
  updateStats,
  type SendMeasure,
  type VoiceStats,
} from "@redlance/core";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  drafts,
  profileExperience,
  replies,
  voiceProfiles,
  type VoiceProfile,
} from "./schema";

export const VOICE_CHANNEL = "voice";

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Rewrite options that say something about style (a project swap or a typed request doesn't). */
const STYLE_OPTIONS = ["shorter", "casual", "formal"] as const;

/**
 * Counts one new send: folds it into the user's stats and, when `shouldUpdateVoice` says so
 * and no update is already waiting or running, queues a voice update and sends
 * NOTIFY `voice` (delivered when the transaction commits). Returns whether one was queued.
 */
export async function recordSend(
  db: Pick<Database, "transaction">,
  userId: string,
  measure: SendMeasure,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.insert(voiceProfiles).values({ userId }).onConflictDoNothing();
    // Locks the row: two sends from one user count one after the other.
    const [row] = await tx
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId))
      .for("update");
    if (!row) throw new Error("voice profile missing");

    const recent = await tx
      .select({ option: drafts.option })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.kind, "rewrite"),
          inArray(drafts.option, [...STYLE_OPTIONS]),
        ),
      )
      .orderBy(desc(drafts.createdAt))
      .limit(3);

    const stats = updateStats(row.stats as VoiceStats | null, measure);
    const sendsCounted = row.sendsCounted + 1;
    const sendsSinceUpdate = row.sendsSinceUpdate + 1;
    const today = utcDay(now);
    const updatesToday = row.updatesDay === today ? row.updatesToday : 0;
    const queue =
      row.updateStatus === "idle" &&
      shouldUpdateVoice({
        sendsCounted,
        sendsSinceUpdate,
        recentOptions: recent.map((r) => r.option!).reverse(),
        updatesToday,
      });

    await tx
      .update(voiceProfiles)
      .set({
        stats: stats as unknown as Record<string, unknown>,
        sendsCounted,
        sendsSinceUpdate,
        updatedAt: now,
        ...(queue
          ? { updateStatus: "pending" as const, updateRunAfter: sql`now()` }
          : {}),
      })
      .where(eq(voiceProfiles.userId, userId));
    if (queue)
      await tx.execute(sql`select pg_notify(${VOICE_CHANNEL}, ${userId})`);
    return queue;
  });
}

// ---- The worker's side ----

/** A claimed update: the row as claimed (`updateLockedAt` fences later writes). */
export type VoiceClaim = VoiceProfile;

/** Takes up to `limit` due pending updates, oldest first. `now` defaults to the database clock. */
export async function claimVoiceUpdates(
  db: Database,
  limit: number,
  now?: Date,
): Promise<VoiceClaim[]> {
  if (limit <= 0) return [];
  const due = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const res = await db.execute<{ user_id: string }>(sql`
    update voice_profiles set
      update_status = 'running',
      update_locked_at = now()
    where user_id in (
      select user_id from voice_profiles
      where update_status = 'pending' and update_run_after <= ${due}
      order by update_run_after, user_id
      limit ${limit}
      for update skip locked)
    returning user_id`);
  const ids = res.rows.map((r) => r.user_id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(voiceProfiles)
    .where(inArray(voiceProfiles.userId, ids))
    .orderBy(voiceProfiles.updateRunAfter, voiceProfiles.userId);
}

// Postgres keeps microseconds, JS dates milliseconds: compare at millisecond precision.
const owned = (claim: Pick<VoiceClaim, "userId" | "updateLockedAt">) =>
  and(
    eq(voiceProfiles.userId, claim.userId),
    eq(voiceProfiles.updateStatus, "running"),
    sql`date_trunc('milliseconds', ${voiceProfiles.updateLockedAt}) = ${claim.updateLockedAt}`,
  );

/**
 * Saves the new notes: the old ones become `previous_notes`, `version` goes up, the
 * sends-since-update counter resets and today's update count goes up. False if the claim
 * was lost.
 */
export async function completeVoiceUpdate(
  db: Pick<Database, "update">,
  claim: Pick<VoiceClaim, "userId" | "updateLockedAt">,
  result: { notes: string; bestReplyIds: string[] },
  now: Date = new Date(),
): Promise<boolean> {
  const today = utcDay(now);
  const rows = await db
    .update(voiceProfiles)
    .set({
      previousNotes: voiceProfiles.notes,
      notes: result.notes,
      version: sql`${voiceProfiles.version} + 1`,
      sendsSinceUpdate: 0,
      bestReplyIds: result.bestReplyIds.slice(0, 2),
      updatesToday: sql`case when ${voiceProfiles.updatesDay} = ${today}::date then ${voiceProfiles.updatesToday} + 1 else 1 end`,
      updatesDay: today,
      updateStatus: "idle",
      updateLockedAt: null,
      updateRunAfter: null,
      updatedAt: now,
    })
    .where(owned(claim))
    .returning({ userId: voiceProfiles.userId });
  return rows.length > 0;
}

/**
 * A failure: `retryInSec` puts the update back in the queue after that delay (a provider
 * outage or a shutdown); without it the update goes idle and the next qualifying send
 * queues it again.
 */
export async function failVoiceUpdate(
  db: Pick<Database, "update">,
  claim: Pick<VoiceClaim, "userId" | "updateLockedAt">,
  fail: { retryInSec?: number } = {},
): Promise<"requeued" | "idle" | "lost"> {
  const retry = fail.retryInSec !== undefined;
  const rows = await db
    .update(voiceProfiles)
    .set(
      retry
        ? {
            updateStatus: "pending",
            updateLockedAt: null,
            updateRunAfter: sql`now() + make_interval(secs => ${Math.max(0, fail.retryInSec!)})`,
          }
        : {
            updateStatus: "idle",
            updateLockedAt: null,
            updateRunAfter: null,
          },
    )
    .where(owned(claim))
    .returning({ userId: voiceProfiles.userId });
  if (rows.length === 0) return "lost";
  return retry ? "requeued" : "idle";
}

/** Rescues updates whose worker died mid-run: back to pending. Returns how many. */
export async function requeueStaleVoiceUpdates(
  db: Database,
  olderThanSec = 120,
): Promise<number> {
  const rows = await db
    .update(voiceProfiles)
    .set({
      updateStatus: "pending",
      updateLockedAt: null,
      updateRunAfter: sql`now()`,
    })
    .where(
      sql`${voiceProfiles.updateStatus} = 'running' and ${voiceProfiles.updateLockedAt} < now() - make_interval(secs => ${olderThanSec})`,
    )
    .returning({ userId: voiceProfiles.userId });
  return rows.length;
}

// ---- Reads ----

export type LoadedVoice = {
  notes: string | null;
  stats: VoiceStats | null;
  bestSends: { text: string; kind: "comment" | "dm" }[];
};

/** The user's voice for the drafter; null when nothing has been sent yet. */
export async function loadVoice(
  db: Pick<Database, "select">,
  userId: string,
): Promise<LoadedVoice | null> {
  const [row] = await db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, userId));
  if (!row) return null;
  const best = row.bestReplyIds.length
    ? await db
        .select({ id: replies.id, text: replies.sentText, kind: replies.kind })
        .from(replies)
        .where(
          and(
            eq(replies.userId, userId),
            inArray(replies.id, row.bestReplyIds),
          ),
        )
    : [];
  // Keep the order the update chose (best first).
  const byId = new Map(best.map((b) => [b.id, b]));
  return {
    notes: row.notes,
    stats: row.stats as VoiceStats | null,
    bestSends: row.bestReplyIds.flatMap((id) => {
      const b = byId.get(id);
      return b ? [{ text: b.text, kind: b.kind }] : [];
    }),
  };
}

export type VoicePairs = {
  /** Newest first: what the AI wrote and what they sent in its place. */
  pairs: { kind: "comment" | "dm"; aiText: string; sentText: string }[];
  /** Newest first: the rewrites they asked for. */
  rewrites: { option: string; instruction: string | null }[];
  /** For `pickBestSends`. */
  candidates: { id: string; editRatio: number; status: string; text: string }[];
};

/** Recent (AI text, sent text) pairs and rewrite requests, for the voice-notes prompt. */
export async function loadVoicePairs(
  db: Pick<Database, "select">,
  userId: string,
  limit = 10,
): Promise<VoicePairs> {
  const sent = await db
    .select({
      id: replies.id,
      kind: replies.kind,
      sentText: replies.sentText,
      editRatio: replies.editRatio,
      status: replies.status,
      comment: drafts.comment,
      dm: drafts.dm,
    })
    .from(replies)
    .innerJoin(drafts, eq(drafts.id, replies.draftId))
    .where(and(eq(replies.userId, userId), isNotNull(replies.editRatio)))
    .orderBy(desc(replies.sentAt))
    .limit(Math.max(limit, 30));
  const rewrites = await db
    .select({ option: drafts.option, instruction: drafts.instruction })
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, userId),
        eq(drafts.kind, "rewrite"),
        isNotNull(drafts.option),
        ne(drafts.option, "different_project"),
      ),
    )
    .orderBy(desc(drafts.createdAt))
    .limit(limit);
  return {
    pairs: sent.slice(0, limit).flatMap((r) => {
      const aiText = (r.kind === "dm" ? r.dm : r.comment) ?? "";
      return aiText.trim()
        ? [{ kind: r.kind, aiText, sentText: r.sentText }]
        : [];
    }),
    rewrites: rewrites.map((r) => ({
      option: r.option!,
      instruction: r.instruction,
    })),
    candidates: sent.map((r) => ({
      id: r.id,
      editRatio: r.editRatio!,
      status: r.status,
      text: r.sentText,
    })),
  };
}

/** The user's role employers (any role, hidden or not), to scrub from the notes. */
export async function loadOrganisations(
  db: Pick<Database, "select">,
  userId: string,
): Promise<{ organisation: string | null; description: string }[]> {
  const rows = await db
    .select({
      organisation: profileExperience.organisation,
      description: profileExperience.organisationDescription,
    })
    .from(profileExperience)
    .where(eq(profileExperience.userId, userId));
  return rows;
}
