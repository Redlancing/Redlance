import "server-only";
import {
  HEAVY_EDIT_RATIO,
  editRatio,
  measureSend,
  type OutcomeType,
  type ReplyKind,
  type ReplyStatus,
} from "@redlance/core";
import {
  draftEvalCandidates,
  drafts,
  jobPosts,
  matchEvents,
  matches,
  outcomes,
  recordSend,
  replies,
  replySends,
  type Reply,
} from "@redlance/db";
import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { ApiError } from "./errors";
import { decodeCursor, encodeCursor } from "./feed";

type UserRef = { userId: string };

export type ReplyView = {
  id: string;
  draftId: string | null;
  matchId: string | null;
  kind: ReplyKind;
  sentText: string;
  editRatio: number | null;
  sentAt: string;
  status: ReplyStatus;
  updatedAt: string;
};

const toView = (r: Reply): ReplyView => ({
  id: r.id,
  draftId: r.draftId,
  matchId: r.matchId,
  kind: r.kind,
  sentText: r.sentText,
  editRatio: r.editRatio,
  sentAt: r.sentAt.toISOString(),
  status: r.status,
  updatedAt: r.updatedAt.toISOString(),
});

export async function markSent(
  user: UserRef,
  input: { draftId: string; kind: ReplyKind; sentText: string },
): Promise<{ reply: ReplyView; created: boolean }> {
  const out = await getDb().transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, input.draftId), eq(drafts.userId, user.userId)));
    if (!draft) throw new ApiError("NOT_FOUND", "Draft not found.");
    if (draft.status !== "done")
      throw new ApiError("DRAFT_NOT_READY", "This draft isn't ready yet.");

    const aiText = (input.kind === "dm" ? draft.dm : draft.comment) ?? "";
    // No AI text for this kind (e.g. an empty comment on a "DM only" post): nothing to compare.
    const ratio = aiText.trim() ? editRatio(input.sentText, aiText) : null;
    const now = new Date();

    // `replies` holds the latest send per post and kind; `inserted` (xmax = 0) is true only
    // for the request that made the row, so two first sends at once count the voice once.
    const [upserted] = await tx
      .insert(replies)
      .values({
        userId: user.userId,
        matchId: draft.matchId,
        jobPostId: draft.jobPostId,
        draftId: draft.id,
        kind: input.kind,
        sentText: input.sentText,
        editRatio: ratio,
        sentAt: now,
      })
      .onConflictDoUpdate({
        target: [replies.userId, replies.jobPostId, replies.kind],
        set: {
          matchId: draft.matchId,
          draftId: draft.id,
          sentText: input.sentText,
          editRatio: ratio,
          sentAt: now,
          updatedAt: now,
        },
      })
      .returning({
        ...getTableColumns(replies),
        inserted: sql<boolean>`(xmax = 0)`,
      });
    const { inserted, ...row } = upserted!;

    // Every send is kept (rule 3: store everything), append-only.
    await tx.insert(replySends).values({
      replyId: row.id,
      userId: user.userId,
      draftId: draft.id,
      sentText: input.sentText,
      editRatio: ratio,
      sentAt: now,
    });

    const [match] = await tx
      .select({ status: matches.status })
      .from(matches)
      .where(
        and(eq(matches.id, draft.matchId), eq(matches.userId, user.userId)),
      )
      .for("update");
    if (match && match.status !== "replied") {
      await tx
        .update(matches)
        .set({ status: "replied", updatedAt: now })
        .where(eq(matches.id, draft.matchId));
      await tx.insert(matchEvents).values({
        matchId: draft.matchId,
        userId: user.userId,
        event: "replied",
      });
    }

    if (ratio !== null && ratio > HEAVY_EDIT_RATIO)
      await tx
        .insert(draftEvalCandidates)
        .values({ draftId: draft.id, reason: "heavy_edit" })
        .onConflictDoNothing();

    return { row: row as Reply, created: inserted, aiText };
  });

  // Voice learning (docs/drafts/plan/09-voice.md): count a new send's style, after the commit.
  // Best effort; the send is already saved, and a resend of the same post is not counted twice.
  if (out.created && out.aiText.trim()) {
    try {
      await recordSend(
        getDb(),
        user.userId,
        measureSend(input.sentText, out.aiText),
      );
    } catch {
      // never fails the request
    }
  }
  return { reply: toView(out.row), created: out.created };
}

export async function updateReply(
  user: UserRef,
  id: string,
  input: {
    status: Exclude<ReplyStatus, "sent">;
    agreedRateMinor?: number;
    currency?: string;
    unpaid?: boolean;
  },
): Promise<ReplyView> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(replies)
      .where(and(eq(replies.id, id), eq(replies.userId, user.userId)))
      .for("update");
    if (!current) throw new ApiError("NOT_FOUND", "Reply not found.");

    const changed = current.status !== input.status;
    const [row] = await tx
      .update(replies)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(replies.id, id))
      .returning();

    // One outcome per status change; a repeat only counts again if it adds a rate.
    if (changed || input.agreedRateMinor !== undefined) {
      await tx.insert(outcomes).values({
        replyId: id,
        userId: user.userId,
        type: input.status as OutcomeType,
        agreedRateMinor: input.agreedRateMinor ?? null,
        currency:
          input.agreedRateMinor !== undefined ? (input.currency ?? null) : null,
      });
    }
    // At most one `unpaid` outcome per reply (the reply row is locked above).
    if (input.unpaid) {
      const [already] = await tx
        .select({ id: outcomes.id })
        .from(outcomes)
        .where(and(eq(outcomes.replyId, id), eq(outcomes.type, "unpaid")))
        .limit(1);
      if (!already)
        await tx.insert(outcomes).values({
          replyId: id,
          userId: user.userId,
          type: "unpaid",
        });
    }
    return toView(row!);
  });
}

export type ReplyListItem = ReplyView & {
  post: { id: string; title: string; community: string; url: string };
};

export async function listReplies(
  user: UserRef,
  opts: { status?: ReplyStatus; cursor?: string; limit: number },
): Promise<{ items: ReplyListItem[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  if (cursor === null)
    throw new ApiError("INVALID_INPUT", "Some fields are invalid.", [
      { path: "cursor", message: "Invalid cursor." },
    ]);
  const rows = await getDb()
    .select({
      r: replies,
      title: jobPosts.title,
      community: jobPosts.community,
      url: jobPosts.url,
    })
    .from(replies)
    .innerJoin(jobPosts, eq(jobPosts.id, replies.jobPostId))
    .where(
      and(
        eq(replies.userId, user.userId),
        opts.status ? eq(replies.status, opts.status) : undefined,
        cursor
          ? or(
              lt(replies.sentAt, cursor.postedAt),
              and(
                eq(replies.sentAt, cursor.postedAt),
                lt(replies.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(replies.sentAt), desc(replies.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  return {
    items: page.map((x) => ({
      ...toView(x.r),
      post: {
        id: x.r.jobPostId,
        title: x.title,
        community: x.community,
        url: x.url,
      },
    })),
    nextCursor:
      rows.length > opts.limit && last
        ? encodeCursor({ postedAt: last.r.sentAt, id: last.r.id })
        : null,
  };
}
