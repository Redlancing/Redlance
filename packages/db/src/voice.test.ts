import { measureSend, type SendMeasure, type VoiceStats } from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import {
  drafts,
  jobPosts,
  matches,
  profileExperience,
  replies,
  users,
  voiceProfiles,
} from "./schema";
import {
  VOICE_CHANNEL,
  claimVoiceUpdates,
  completeVoiceUpdate,
  failVoiceUpdate,
  loadOrganisations,
  loadVoice,
  loadVoicePairs,
  recordSend,
  requeueStaleVoiceUpdates,
} from "./voice";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 4 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
};

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

let seq = 0;
const NOW = new Date("2026-10-19T10:00:00Z");

async function seedUser(): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|v${seq}-${Math.random()}`,
      email: `v${seq}@example.com`,
      emailNormalized: `v${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  return u!.id;
}

const measure = (
  sent = "hey! saw your post, happy to help with this one.",
): SendMeasure =>
  measureSend(sent, "Hi, I saw your post and would be glad to help with this.");

const row = async (userId: string) =>
  (
    await db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId))
  )[0]!;

/** A sent reply with its draft, for the pair and best-send reads. */
async function seedSend(
  userId: string,
  over: {
    ai?: string;
    sent?: string;
    ratio?: number;
    status?: "sent" | "replied";
    at?: Date;
  } = {},
) {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_v${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/v${seq}/x/`,
      title: "[Hiring] Gig",
      body: "Need help.",
      postedAt: NOW,
      preKind: "hiring",
    })
    .returning({ id: jobPosts.id });
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: NOW,
      ruleScore: 50,
      broad: false,
      features: [],
      ruleReason: "r",
      aiStatus: "not_needed",
      score: 50,
      profileVersion: 1,
      analysedAt: NOW,
    })
    .returning({ id: matches.id });
  const [d] = await db
    .insert(drafts)
    .values({
      userId,
      matchId: m!.id,
      jobPostId: p!.id,
      version: 1,
      kind: "draft",
      status: "done",
      comment: "c",
      dm: over.ai ?? "The AI wrote this.",
      idempotencyKey: `k-${Math.random()}`,
    })
    .returning({ id: drafts.id });
  const [r] = await db
    .insert(replies)
    .values({
      userId,
      matchId: m!.id,
      jobPostId: p!.id,
      draftId: d!.id,
      kind: "dm",
      sentText: over.sent ?? "The user sent this.",
      editRatio: over.ratio ?? 0.3,
      status: over.status ?? "sent",
      sentAt: over.at ?? NOW,
    })
    .returning({ id: replies.id });
  return { replyId: r!.id, draftId: d!.id, matchId: m!.id, jobPostId: p!.id };
}

async function notifications(run: () => Promise<unknown>): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`LISTEN ${VOICE_CHANNEL}`);
  const got: string[] = [];
  c.on("notification", (n) => got.push(n.payload ?? ""));
  await run();
  await new Promise((r) => setTimeout(r, 150));
  await c.end();
  return got;
}

describe("recordSend", () => {
  it("12: three sends: n = 3, pending, NOTIFY voice (once)", async () => {
    const u = await seedUser();
    const got = await notifications(async () => {
      expect(await recordSend(db, u, measure(), NOW)).toBe(false);
      expect(await recordSend(db, u, measure(), NOW)).toBe(false);
      expect(await recordSend(db, u, measure(), NOW)).toBe(true);
    });
    const r = await row(u);
    expect((r.stats as VoiceStats).n).toBe(3);
    expect(r.sendsCounted).toBe(3);
    expect(r.sendsSinceUpdate).toBe(3);
    expect(r.updateStatus).toBe("pending");
    expect(got).toEqual([u]);
  });

  it("does not queue again while an update is waiting", async () => {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await recordSend(db, u, measure(), NOW);
    expect(await recordSend(db, u, measure(), NOW)).toBe(false);
    expect((await row(u)).updateStatus).toBe("pending");
  });

  it("queues again after 5 sends since the update", async () => {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await recordSend(db, u, measure(), NOW);
    const [claim] = await claimVoiceUpdates(db, 1);
    await completeVoiceUpdate(
      db,
      claim!,
      { notes: "n", bestReplyIds: [] },
      NOW,
    );
    for (let i = 0; i < 4; i++)
      expect(await recordSend(db, u, measure(), NOW)).toBe(false);
    expect(await recordSend(db, u, measure(), NOW)).toBe(true);
  });

  it("queues when the last 3 rewrite options are the same", async () => {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await recordSend(db, u, measure(), NOW);
    const [claim] = await claimVoiceUpdates(db, 1);
    await completeVoiceUpdate(
      db,
      claim!,
      { notes: "n", bestReplyIds: [] },
      NOW,
    );
    const s = await seedSend(u);
    for (let v = 2; v <= 4; v++)
      await db.insert(drafts).values({
        userId: u,
        matchId: s.matchId,
        jobPostId: s.jobPostId,
        version: v,
        kind: "rewrite",
        option: "shorter",
        idempotencyKey: `k-${Math.random()}`,
      });
    expect(await recordSend(db, u, measure(), NOW)).toBe(true);
  });
});

describe("the update queue", () => {
  async function queued(): Promise<string> {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await recordSend(db, u, measure(), NOW);
    return u;
  }

  it("claims once and fences the later writes", async () => {
    const u = await queued();
    const [claim] = await claimVoiceUpdates(db, 5);
    expect(claim!.userId).toBe(u);
    expect(await claimVoiceUpdates(db, 5)).toEqual([]);
    expect((await row(u)).updateStatus).toBe("running");
    // A claim whose lock was swept and taken again by another worker can't write.
    await db
      .update(voiceProfiles)
      .set({ updateLockedAt: new Date(Date.now() - 1000) })
      .where(eq(voiceProfiles.userId, u));
    expect(
      await completeVoiceUpdate(db, claim!, { notes: "x", bestReplyIds: [] }),
    ).toBe(false);
    expect(await failVoiceUpdate(db, claim!)).toBe("lost");
    expect((await row(u)).notes).toBeNull();
  });

  it("14: complete keeps the old notes as previous_notes and bumps the version", async () => {
    const u = await queued();
    const [c1] = await claimVoiceUpdates(db, 1);
    expect(
      await completeVoiceUpdate(
        db,
        c1!,
        { notes: "first", bestReplyIds: [] },
        NOW,
      ),
    ).toBe(true);
    let r = await row(u);
    expect(r).toMatchObject({
      notes: "first",
      previousNotes: null,
      version: 1,
      sendsSinceUpdate: 0,
      updateStatus: "idle",
      updatesToday: 1,
      updatesDay: "2026-10-19",
    });
    await db
      .update(voiceProfiles)
      .set({
        updateStatus: "pending",
        updateRunAfter: new Date(Date.now() - 60_000),
      })
      .where(eq(voiceProfiles.userId, u));
    const [c2] = await claimVoiceUpdates(db, 1);
    await completeVoiceUpdate(
      db,
      c2!,
      { notes: "second", bestReplyIds: [] },
      NOW,
    );
    r = await row(u);
    expect(r).toMatchObject({
      notes: "second",
      previousNotes: "first",
      version: 2,
      updatesToday: 2,
    });
  });

  it("a new UTC day restarts the day's count", async () => {
    const u = await queued();
    const [c] = await claimVoiceUpdates(db, 1);
    await completeVoiceUpdate(db, c!, { notes: "a", bestReplyIds: [] }, NOW);
    await db
      .update(voiceProfiles)
      .set({
        updateStatus: "pending",
        updateRunAfter: new Date(Date.now() - 60_000),
      })
      .where(eq(voiceProfiles.userId, u));
    const [c2] = await claimVoiceUpdates(db, 1);
    await completeVoiceUpdate(
      db,
      c2!,
      { notes: "b", bestReplyIds: [] },
      new Date("2026-10-20T00:01:00Z"),
    );
    expect(await row(u)).toMatchObject({
      updatesToday: 1,
      updatesDay: "2026-10-20",
    });
  });

  it("16: two updates today: a third trigger is not queued", async () => {
    const u = await seedUser();
    await db.insert(voiceProfiles).values({
      userId: u,
      sendsCounted: 9,
      sendsSinceUpdate: 5,
      updatesToday: 2,
      updatesDay: "2026-10-19",
    });
    expect(await recordSend(db, u, measure(), NOW)).toBe(false);
    expect((await row(u)).updateStatus).toBe("idle");
    // The next day it is.
    expect(
      await recordSend(db, u, measure(), new Date("2026-10-20T08:00:00Z")),
    ).toBe(true);
  });

  it("fail: a retry waits, anything else goes idle", async () => {
    const u = await queued();
    const [c] = await claimVoiceUpdates(db, 1);
    expect(await failVoiceUpdate(db, c!, { retryInSec: 3600 })).toBe(
      "requeued",
    );
    expect((await row(u)).updateStatus).toBe("pending");
    expect(await claimVoiceUpdates(db, 1)).toEqual([]); // not due yet
    await db
      .update(voiceProfiles)
      .set({ updateRunAfter: new Date(Date.now() - 60_000) });
    const [c2] = await claimVoiceUpdates(db, 1);
    expect(await failVoiceUpdate(db, c2!)).toBe("idle");
    expect((await row(u)).updateStatus).toBe("idle");
  });

  it("18: a stale running update goes back to pending", async () => {
    const u = await queued();
    await claimVoiceUpdates(db, 1);
    expect(await requeueStaleVoiceUpdates(db, 120)).toBe(0);
    await db
      .update(voiceProfiles)
      .set({ updateLockedAt: new Date(Date.now() - 600_000) })
      .where(eq(voiceProfiles.userId, u));
    expect(await requeueStaleVoiceUpdates(db, 120)).toBe(1);
    expect((await row(u)).updateStatus).toBe("pending");
    expect(await claimVoiceUpdates(db, 1)).toHaveLength(1);
  });
});

describe("reads", () => {
  it("loadVoice: null without a profile; notes, stats and the best sends in order", async () => {
    const u = await seedUser();
    expect(await loadVoice(db, u)).toBeNull();
    const a = await seedSend(u, { sent: "first send" });
    const b = await seedSend(u, { sent: "second send" });
    await db.insert(voiceProfiles).values({
      userId: u,
      notes: "Short sentences.",
      bestReplyIds: [b.replyId, a.replyId],
    });
    const v = await loadVoice(db, u);
    expect(v!.notes).toBe("Short sentences.");
    expect(v!.bestSends).toEqual([
      { text: "second send", kind: "dm" },
      { text: "first send", kind: "dm" },
    ]);
  });

  it("loadVoicePairs: pairs newest first, rewrite requests, candidates", async () => {
    const u = await seedUser();
    const old = await seedSend(u, {
      ai: "old ai",
      sent: "old sent",
      at: new Date(NOW.getTime() - 86_400_000),
    });
    await seedSend(u, { ai: "new ai", sent: "new sent", status: "replied" });
    await db.insert(drafts).values({
      userId: u,
      matchId: old.matchId,
      jobPostId: old.jobPostId,
      version: 2,
      kind: "rewrite",
      option: "custom",
      instruction: "drop the greeting",
      idempotencyKey: `k-${Math.random()}`,
    });
    const p = await loadVoicePairs(db, u, 10);
    expect(p.pairs.map((x) => [x.aiText, x.sentText])).toEqual([
      ["new ai", "new sent"],
      ["old ai", "old sent"],
    ]);
    expect(p.rewrites).toEqual([
      { option: "custom", instruction: "drop the greeting" },
    ]);
    expect(p.candidates).toHaveLength(2);
    expect(p.candidates[0]).toMatchObject({
      status: "replied",
      text: "new sent",
    });
  });

  it("loadOrganisations lists every role's employer", async () => {
    const u = await seedUser();
    await db.insert(profileExperience).values({
      userId: u,
      position: 0,
      title: "Developer",
      summary: "Built things.",
      organisation: "Acme Realty",
      organisationDescription: "a property firm",
      employmentType: "full_time",
      source: "manual",
    } as typeof profileExperience.$inferInsert);
    expect(await loadOrganisations(db, u)).toEqual([
      { organisation: "Acme Realty", description: "a property firm" },
    ]);
  });
});
