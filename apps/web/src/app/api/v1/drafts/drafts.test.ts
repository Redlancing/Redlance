import { randomUUID } from "node:crypto";
import {
  creditLedger,
  draftEvalCandidates,
  draftFeedback,
  drafts,
  llmUsage,
  matches,
  profileProjects,
} from "@redlance/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import {
  clearPosts,
  seedMatch,
  seedPost,
} from "../../../../../test/feed-fixtures";
import {
  balanceOf,
  failDraftRow,
  finishDraft,
  seedDraftUser,
  seedProject,
  userIdOf,
} from "../../../../../test/draft-fixtures";
import { TEST_ENV } from "../../../../../test/test-env";
import { GET as getCredits } from "../credits/route";
import { GET as getDraftRoute } from "./[id]/route";
import { POST as feedbackRoute } from "./[id]/feedback/route";
import { POST as rewriteRoute } from "./[id]/rewrite/route";
import { GET as listRoute, POST as startRoute } from "./route";

beforeEach(async () => {
  await resetState();
  await clearPosts();
});
afterAll(closeAll);

async function setup(email = "dev@example.com", over = {}) {
  const cookie = await cookieFor(email);
  const userId = await userIdOf(email);
  await seedDraftUser(userId, over);
  const matchId = await seedMatch(userId, await seedPost());
  return { cookie, userId, matchId };
}

const post = (cookie: string, body: unknown, withOrigin = true) =>
  startRoute(
    req("/api/v1/drafts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(withOrigin ? { origin: TEST_ENV.APP_ORIGIN } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const start = (cookie: string, matchId: string, key = randomUUID()) =>
  post(cookie, { matchId, idempotencyKey: key });

const getDraft = (cookie: string, id: string) =>
  getDraftRoute(req(`/api/v1/drafts/${id}`, { headers: { cookie } }), {
    params: Promise.resolve({ id }),
  });

const rewrite = (cookie: string, id: string, body: object) =>
  rewriteRoute(
    req(`/api/v1/drafts/${id}/rewrite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: TEST_ENV.APP_ORIGIN,
      },
      body: JSON.stringify({ idempotencyKey: randomUUID(), ...body }),
    }),
    { params: Promise.resolve({ id }) },
  );

const feedback = (cookie: string, id: string, body: object = {}) =>
  feedbackRoute(
    req(`/api/v1/drafts/${id}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: TEST_ENV.APP_ORIGIN,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const projectIdOf = async (userId: string) =>
  (
    await getDb()
      .select({ id: profileProjects.id })
      .from(profileProjects)
      .where(eq(profileProjects.userId, userId))
  )[0]?.id;

/** Starts a draft and finishes it as the worker would. */
async function doneDraft(cookie: string, matchId: string): Promise<string> {
  const res = await start(cookie, matchId);
  const { draftId } = await res.json();
  await finishDraft(draftId);
  return draftId;
}

describe("POST /drafts", () => {
  it("1: needs a session and the right origin", async () => {
    const { cookie, matchId } = await setup();
    expect(
      (await post("", { matchId, idempotencyKey: randomUUID() })).status,
    ).toBe(401);
    expect(
      (await post(cookie, { matchId, idempotencyKey: randomUUID() }, false))
        .status,
    ).toBe(403);
  });

  it("2: another user's match is a 404", async () => {
    const { matchId } = await setup("a@example.com");
    const { cookie } = await setup("b@example.com");
    expect((await start(cookie, matchId)).status).toBe(404);
  });

  it("3: an expired trial is PLAN_EXPIRED", async () => {
    const { cookie, matchId } = await setup("dev@example.com", {
      trialEndsAt: new Date(Date.now() - 1000),
    });
    const res = await start(cookie, matchId);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PLAN_EXPIRED");
  });

  it("4: happy path queues a draft and takes 7 credits", async () => {
    const { cookie, userId, matchId } = await setup();
    const res = await start(cookie, matchId);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ status: "pending", slowDown: false });
    expect(typeof body.draftId).toBe("string");
    expect(await balanceOf(userId)).toBe(203);
  });

  it("5: the same idempotency key returns the same draft, charged once", async () => {
    const { cookie, userId, matchId } = await setup();
    const key = randomUUID();
    const a = await (await start(cookie, matchId, key)).json();
    const b = await (await start(cookie, matchId, key)).json();
    expect(b.draftId).toBe(a.draftId);
    expect(await balanceOf(userId)).toBe(203);
  });

  it("5b: an idempotency key reused for a different match is rejected", async () => {
    const { cookie, userId, matchId } = await setup();
    const other = await seedMatch(userId, await seedPost());
    const key = randomUUID();
    await start(cookie, matchId, key);
    const res = await start(cookie, other, key);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await balanceOf(userId)).toBe(203);
  });

  it("6: a new key after v1 exists returns v1 for free", async () => {
    const { cookie, userId, matchId } = await setup();
    const a = await (await start(cookie, matchId)).json();
    const res = await start(cookie, matchId);
    expect(res.status).toBe(200);
    expect((await res.json()).draftId).toBe(a.draftId);
    expect(await balanceOf(userId)).toBe(203);
  });

  it("6b: a failed v1 doesn't block the match: a new key makes a new draft (H1)", async () => {
    const { cookie, userId, matchId } = await setup();
    const a = await (await start(cookie, matchId)).json();
    await failDraftRow(a.draftId, userId);
    expect(await balanceOf(userId)).toBe(210);
    const res = await start(cookie, matchId);
    expect(res.status).toBe(202);
    const b = await res.json();
    expect(b.draftId).not.toBe(a.draftId);
    expect(await balanceOf(userId)).toBe(203);
    const rows = await getDb()
      .select()
      .from(drafts)
      .where(eq(drafts.matchId, matchId));
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "pending"]);
  });

  it("6c: a v1 stuck pending for over 10 minutes is expired, refunded and replaced (M4)", async () => {
    const { cookie, userId, matchId } = await setup();
    const a = await (await start(cookie, matchId)).json();
    await getDb()
      .update(drafts)
      .set({ createdAt: sql`now() - interval '11 minutes'` })
      .where(eq(drafts.id, a.draftId));
    const res = await start(cookie, matchId);
    expect(res.status).toBe(202);
    const b = await res.json();
    expect(b.draftId).not.toBe(a.draftId);
    const [old] = await getDb()
      .select()
      .from(drafts)
      .where(eq(drafts.id, a.draftId));
    expect(old).toMatchObject({ status: "failed", error: "EXPIRED" });
    expect(await balanceOf(userId)).toBe(203);
  });

  it("7: a balance of 6 is INSUFFICIENT_CREDITS", async () => {
    const { cookie, matchId } = await setup("dev@example.com", { balance: 6 });
    const res = await start(cookie, matchId);
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("8: the daily cap is DAILY_LIMIT", async () => {
    const { cookie, userId } = await setup();
    // Trial cap is 105 a day: 15 drafts of 7.
    await getDb()
      .insert(creditLedger)
      .values({ userId, delta: -105, reason: "reserve" });
    const matchId = await seedMatch(userId, await seedPost());
    const res = await start(cookie, matchId);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("DAILY_LIMIT");
  });

  it("9: drafting paused for the system is a 503", async () => {
    const { cookie, matchId } = await setup();
    await getDb().insert(llmUsage).values({
      task: "draft",
      step: "draft",
      promptVersion: "t",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 90_000_000,
      latencyMs: 1,
      attempt: 1,
      outcome: "ok",
    });
    const res = await start(cookie, matchId);
    expect(res.status).toBe(503);
  });

  it("10: the 11th draft in an hour is allowed with slowDown", async () => {
    const { cookie, userId } = await setup();
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      const matchId = await seedMatch(userId, await seedPost());
      last = await start(cookie, matchId);
      expect(last.status).toBe(202);
    }
    expect((await last!.json()).slowDown).toBe(true);
  });

  it("rejects a bad body", async () => {
    const { cookie } = await setup();
    expect((await post(cookie, { matchId: "nope" })).status).toBe(400);
  });
});

describe("GET /drafts/:id", () => {
  it("11: pending, then done with the texts", async () => {
    const { cookie, matchId } = await setup();
    const { draftId } = await (await start(cookie, matchId)).json();
    const pending = await (await getDraft(cookie, draftId)).json();
    expect(pending).toMatchObject({
      status: "pending",
      comment: null,
      dm: null,
    });
    await finishDraft(draftId);
    const done = await (await getDraft(cookie, draftId)).json();
    expect(done).toMatchObject({
      status: "done",
      version: 1,
      evidenceSummary: { projectTitle: "SaaS migration", skills: ["Next.js"] },
      redFlags: [],
      applyInstructions: null,
      creditsCharged: 7,
    });
    expect(done.comment).toContain("Next.js");
    expect(done.dm).toContain("Hi,");
  });

  it("11c: red flags are the same pending and done, with pay-type flags (L1)", async () => {
    const { cookie, userId } = await setup();
    const matchId = await seedMatch(
      userId,
      await seedPost({ payType: "unpaid", redFlags: ["Vague budget"] }),
    );
    const { draftId } = await (await start(cookie, matchId)).json();
    const pending = await (await getDraft(cookie, draftId)).json();
    await finishDraft(draftId, {
      evidence: { summary: null, redFlags: ["something else"] },
    });
    const done = await (await getDraft(cookie, draftId)).json();
    expect(pending.redFlags).toEqual(["Vague budget", "unpaid"]);
    expect(done.redFlags).toEqual(pending.redFlags);
  });

  it("11d: polling a draft stuck for over 10 minutes expires and refunds it (M4)", async () => {
    const { cookie, userId, matchId } = await setup();
    const { draftId } = await (await start(cookie, matchId)).json();
    await getDb()
      .update(drafts)
      .set({ createdAt: sql`now() - interval '11 minutes'` })
      .where(eq(drafts.id, draftId));
    const body = await (await getDraft(cookie, draftId)).json();
    expect(body).toMatchObject({ status: "failed", error: "EXPIRED" });
    expect(await balanceOf(userId)).toBe(210);
  });

  it("11b: applyInstructions comes from the analysis", async () => {
    const { cookie, userId } = await setup();
    const matchId = await seedMatch(
      userId,
      await seedPost({ applyInstructions: "DM only" }),
    );
    const { draftId } = await (await start(cookie, matchId)).json();
    await finishDraft(draftId);
    expect(
      (await (await getDraft(cookie, draftId)).json()).applyInstructions,
    ).toBe("DM only");
  });

  it("12: another user's draft is a 404", async () => {
    const { cookie, matchId } = await setup("a@example.com");
    const { draftId } = await (await start(cookie, matchId)).json();
    const { cookie: other } = await setup("b@example.com");
    expect((await getDraft(other, draftId)).status).toBe(404);
  });

  it("13: never returns the evidence text or the prompt", async () => {
    const { cookie, matchId } = await setup();
    const draftId = await doneDraft(cookie, matchId);
    const text = await (await getDraft(cookie, draftId)).text();
    expect(text).not.toContain("evidenceText");
    expect(text).not.toContain("SECRET-EVIDENCE-TEXT");
    expect(text).not.toMatch(/prompt/i);
  });
});

describe("POST /drafts/:id/rewrite", () => {
  it("14: shorter makes v2 for 1 credit", async () => {
    const { cookie, userId, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    const res = await rewrite(cookie, id, { option: "shorter" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ version: 2, status: "pending" });
    expect(await balanceOf(userId)).toBe(210 - 7 - 1);
    const [row] = await getDb()
      .select()
      .from(drafts)
      .where(eq(drafts.id, body.draftId));
    expect(row).toMatchObject({
      parentId: id,
      kind: "rewrite",
      option: "shorter",
    });
  });

  it("14b: a typed instruction is a custom rewrite", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    const res = await rewrite(cookie, id, {
      instruction: "mention I can start today",
    });
    expect(res.status).toBe(202);
    const [row] = await getDb()
      .select()
      .from(drafts)
      .where(eq(drafts.id, (await res.json()).draftId));
    expect(row).toMatchObject({
      option: "custom",
      instruction: "mention I can start today",
    });
  });

  it("15: different_project costs 7", async () => {
    const { cookie, userId, matchId } = await setup();
    await seedProject(userId, "SaaS migration", 0);
    await seedProject(userId, "Booking site", 1);
    const id = await doneDraft(cookie, matchId);
    await rewrite(cookie, id, { option: "different_project" });
    expect(await balanceOf(userId)).toBe(210 - 14);
  });

  it("16: a pending draft can't be rewritten", async () => {
    const { cookie, matchId } = await setup();
    const { draftId } = await (await start(cookie, matchId)).json();
    const res = await rewrite(cookie, draftId, { option: "shorter" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DRAFT_NOT_READY");
  });

  it("17: the fifth rewrite (v6) is MAX_VERSIONS", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    for (let i = 0; i < 4; i++) {
      const res = await rewrite(cookie, id, { option: "casual" });
      expect(res.status).toBe(202);
      await finishDraft((await res.json()).draftId);
    }
    const res = await rewrite(cookie, id, { option: "casual" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("MAX_VERSIONS");
  });

  it("17b: replaying a rewrite's key after v5 exists still returns it", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    let lastKey = "";
    let lastId = "";
    for (let i = 0; i < 4; i++) {
      lastKey = randomUUID();
      const res = await rewrite(cookie, id, {
        option: "casual",
        idempotencyKey: lastKey,
      });
      lastId = (await res.json()).draftId;
    }
    const again = await rewrite(cookie, id, {
      option: "casual",
      idempotencyKey: lastKey,
    });
    expect(again.status).toBe(202);
    expect((await again.json()).draftId).toBe(lastId);
  });

  it("17c: failed rewrites don't use up versions (H1)", async () => {
    const { cookie, userId, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    for (let i = 0; i < 4; i++) {
      const res = await rewrite(cookie, id, { option: "casual" });
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.version).toBe(2);
      await failDraftRow(body.draftId, userId);
    }
    const res = await rewrite(cookie, id, { option: "casual" });
    expect(res.status).toBe(202);
    expect((await res.json()).version).toBe(2);
    expect(await balanceOf(userId)).toBe(210 - 7 - 1);
  });

  it("17d: a withdrawn match can't be rewritten, nothing charged (L2)", async () => {
    const { cookie, userId, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    await getDb()
      .update(matches)
      .set({ withdrawnAt: new Date() })
      .where(eq(matches.id, matchId));
    const res = await rewrite(cookie, id, { option: "shorter" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("MATCH_WITHDRAWN");
    expect(await balanceOf(userId)).toBe(203);
  });

  it("17e: different_project with no other project is refused before charging (L2)", async () => {
    const { cookie, userId, matchId } = await setup();
    await seedProject(userId, "SaaS migration");
    const id = await doneDraft(cookie, matchId);
    await getDb()
      .update(drafts)
      .set({
        evidence: {
          project: {
            id: (await projectIdOf(userId))!,
            title: "SaaS migration",
          },
          citedProjectIds: [(await projectIdOf(userId))!],
          summary: null,
        },
      })
      .where(eq(drafts.id, id));
    const res = await rewrite(cookie, id, { option: "different_project" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_OTHER_PROJECT");
    expect(await balanceOf(userId)).toBe(203);
  });

  it("17f: user B can't rewrite user A's draft (L9)", async () => {
    const a = await setup("a@example.com");
    const id = await doneDraft(a.cookie, a.matchId);
    const b = await setup("b@example.com");
    const res = await rewrite(b.cookie, id, { option: "shorter" });
    expect(res.status).toBe(404);
    expect(await balanceOf(a.userId)).toBe(203);
    expect(await balanceOf(b.userId)).toBe(210);
    expect(
      await getDb().select().from(drafts).where(eq(drafts.parentId, id)),
    ).toHaveLength(0);
  });

  it("18: a 201-character instruction is INVALID_INPUT", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    const res = await rewrite(cookie, id, { instruction: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("needs exactly one of option and instruction", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    expect((await rewrite(cookie, id, {})).status).toBe(400);
    expect(
      (await rewrite(cookie, id, { option: "shorter", instruction: "hi" }))
        .status,
    ).toBe(400);
    expect((await rewrite(cookie, id, { option: "custom" })).status).toBe(400);
  });
});

describe("GET /drafts?matchId=", () => {
  it("19: lists versions in order", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    await rewrite(cookie, id, { option: "shorter" });
    const res = await listRoute(
      req(`/api/v1/drafts?matchId=${matchId}`, { headers: { cookie } }),
    );
    const body = await res.json();
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([
      1, 2,
    ]);
    expect(JSON.stringify(body)).not.toContain("evidenceText");
  });

  it("19b: failed versions are left out of the list (H1)", async () => {
    const { cookie, userId, matchId } = await setup();
    const a = await (await start(cookie, matchId)).json();
    await failDraftRow(a.draftId, userId);
    const b = await (await start(cookie, matchId)).json();
    await finishDraft(b.draftId);
    const r = await rewrite(cookie, b.draftId, { option: "shorter" });
    await failDraftRow((await r.json()).draftId, userId);
    const body = await (
      await listRoute(
        req(`/api/v1/drafts?matchId=${matchId}`, { headers: { cookie } }),
      )
    ).json();
    expect(body.versions.map((v: { id: string }) => v.id)).toEqual([b.draftId]);
  });

  it("is empty for another user's match", async () => {
    const { matchId } = await setup("a@example.com");
    const { cookie } = await setup("b@example.com");
    const res = await listRoute(
      req(`/api/v1/drafts?matchId=${matchId}`, { headers: { cookie } }),
    );
    expect((await res.json()).versions).toEqual([]);
  });
});

describe("POST /drafts/:id/feedback", () => {
  it("26: twice leaves one feedback row and one eval candidate", async () => {
    const { cookie, matchId } = await setup();
    const id = await doneDraft(cookie, matchId);
    expect((await feedback(cookie, id, { reason: "too formal" })).status).toBe(
      201,
    );
    expect(
      (await feedback(cookie, id, { reason: "still too formal" })).status,
    ).toBe(201);
    const rows = await getDb()
      .select()
      .from(draftFeedback)
      .where(eq(draftFeedback.draftId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("still too formal");
    const cands = await getDb()
      .select()
      .from(draftEvalCandidates)
      .where(
        and(
          eq(draftEvalCandidates.draftId, id),
          eq(draftEvalCandidates.reason, "thumbs_down"),
        ),
      );
    expect(cands).toHaveLength(1);
  });

  it("rejects a long reason and another user's draft", async () => {
    const { cookie, matchId } = await setup("a@example.com");
    const id = await doneDraft(cookie, matchId);
    expect(
      (await feedback(cookie, id, { reason: "x".repeat(301) })).status,
    ).toBe(400);
    const { cookie: other } = await setup("b@example.com");
    expect((await feedback(other, id)).status).toBe(404);
  });
});

describe("GET /credits", () => {
  it("27: balance, repliesLeft and usedToday", async () => {
    const { cookie, matchId } = await setup();
    await start(cookie, matchId);
    const res = await getCredits(
      req("/api/v1/credits", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      plan: "trial",
      balance: 203,
      repliesLeft: 29,
      usedToday: 7,
      dailyCap: 105,
    });
    expect(typeof body.periodEnd).toBe("string");
  });

  it("is zeros for a user without credits", async () => {
    const cookie = await cookieFor("new@example.com");
    const body = await (
      await getCredits(req("/api/v1/credits", { headers: { cookie } }))
    ).json();
    expect(body).toMatchObject({
      plan: null,
      balance: 0,
      repliesLeft: 0,
      periodEnd: null,
    });
  });
});
