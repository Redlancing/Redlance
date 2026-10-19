import { randomUUID } from "node:crypto";
import {
  draftEvalCandidates,
  drafts,
  matches,
  outcomes,
  replies,
  replySends,
  voiceProfiles,
} from "@redlance/db";
import { eq } from "drizzle-orm";
import pg from "pg";
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
  finishDraft,
  seedDraftUser,
  userIdOf,
} from "../../../../../test/draft-fixtures";
import { TEST_ENV } from "../../../../../test/test-env";
import { POST as startRoute } from "../drafts/route";
import { PATCH as patchRoute } from "./[id]/route";
import { GET as listRoute, POST as sendRoute } from "./route";

beforeEach(async () => {
  await resetState();
  await clearPosts();
});
afterAll(closeAll);

const json = (cookie: string, method: string, body: unknown) => ({
  method,
  headers: {
    "content-type": "application/json",
    cookie,
    origin: TEST_ENV.APP_ORIGIN,
  },
  body: JSON.stringify(body),
});

async function setup(email = "dev@example.com") {
  const cookie = await cookieFor(email);
  const userId = await userIdOf(email);
  await seedDraftUser(userId);
  return { cookie, userId };
}

/** A finished draft on a fresh match; returns ids. */
async function draftFor(cookie: string, userId: string) {
  const matchId = await seedMatch(userId, await seedPost());
  const res = await startRoute(
    req(
      "/api/v1/drafts",
      json(cookie, "POST", { matchId, idempotencyKey: randomUUID() }),
    ),
  );
  const { draftId } = await res.json();
  await finishDraft(draftId);
  return { draftId, matchId };
}

const send = (cookie: string, body: unknown) =>
  sendRoute(req("/api/v1/replies", json(cookie, "POST", body)));
const patch = (cookie: string, id: string, body: unknown) =>
  patchRoute(req(`/api/v1/replies/${id}`, json(cookie, "PATCH", body)), {
    params: Promise.resolve({ id }),
  });
const list = (cookie: string, qs = "") =>
  listRoute(req(`/api/v1/replies${qs}`, { headers: { cookie } }));

const DM =
  "Hi, saw your post about moving to Next.js. I recently shipped a similar migration and can start this week. What does your current stack look like?";

describe("POST /replies", () => {
  it("20: a sent dm is stored, the match becomes replied, edit_ratio stored", async () => {
    const { cookie, userId } = await setup();
    const { draftId, matchId } = await draftFor(cookie, userId);
    const res = await send(cookie, { draftId, kind: "dm", sentText: DM });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      kind: "dm",
      status: "sent",
      editRatio: 0,
      sentText: DM,
    });
    const [m] = await getDb()
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(m!.status).toBe("replied");
    const [row] = await getDb()
      .select()
      .from(replies)
      .where(eq(replies.id, body.id));
    expect(row!.editRatio).toBe(0);
    expect(row!.draftId).toBe(draftId);
  });

  it("12: three sends build the voice profile and queue a voice update (NOTIFY voice)", async () => {
    const { cookie, userId } = await setup();
    const got: string[] = [];
    const listener = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL });
    await listener.connect();
    listener.on("notification", (n) => got.push(n.payload ?? ""));
    await listener.query("LISTEN voice");
    for (let i = 0; i < 3; i++) {
      const { draftId } = await draftFor(cookie, userId);
      expect(
        (await send(cookie, { draftId, kind: "dm", sentText: DM })).status,
      ).toBe(201);
    }
    await new Promise((r) => setTimeout(r, 200));
    await listener.end();
    const [v] = await getDb()
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId));
    expect((v!.stats as { n: number }).n).toBe(3);
    expect(v).toMatchObject({ sendsCounted: 3, updateStatus: "pending" });
    expect(got).toEqual([userId]);
  });

  it("a resend of the same post is not counted twice", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    await send(cookie, { draftId, kind: "dm", sentText: DM });
    await send(cookie, { draftId, kind: "dm", sentText: `${DM} Thanks.` });
    const [v] = await getDb()
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId));
    expect(v!.sendsCounted).toBe(1);
  });

  it("rejects a draft that is pending, not yours, or too long", async () => {
    const { cookie, userId } = await setup();
    const matchId = await seedMatch(userId, await seedPost());
    const { draftId } = await (
      await startRoute(
        req(
          "/api/v1/drafts",
          json(cookie, "POST", { matchId, idempotencyKey: randomUUID() }),
        ),
      )
    ).json();
    const pending = await send(cookie, { draftId, kind: "dm", sentText: "hi" });
    expect(pending.status).toBe(409);
    expect((await pending.json()).error.code).toBe("DRAFT_NOT_READY");
    const other = await setup("b@example.com");
    expect(
      (await send(other.cookie, { draftId, kind: "dm", sentText: "hi" }))
        .status,
    ).toBe(404);
    expect(
      (
        await send(cookie, {
          draftId,
          kind: "dm",
          sentText: "x".repeat(10_001),
        })
      ).status,
    ).toBe(400);
  });

  it("21: a very different text adds a heavy_edit eval candidate", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    const res = await send(cookie, {
      draftId,
      kind: "dm",
      sentText:
        "Totally different words entirely, nothing in common whatsoever with the original suggestion text.",
    });
    expect((await res.json()).editRatio).toBeGreaterThan(0.6);
    const c = await getDb()
      .select()
      .from(draftEvalCandidates)
      .where(eq(draftEvalCandidates.draftId, draftId));
    expect(c.map((r) => r.reason)).toEqual(["heavy_edit"]);
  });

  it("a light edit adds no candidate", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    await send(cookie, { draftId, kind: "dm", sentText: DM + " Thanks!" });
    expect(await getDb().select().from(draftEvalCandidates)).toHaveLength(0);
  });

  it("22: sending the same kind twice keeps one row with the new text", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    await send(cookie, { draftId, kind: "dm", sentText: DM });
    const second = await send(cookie, {
      draftId,
      kind: "dm",
      sentText: DM + " Cheers.",
    });
    expect(second.status).toBe(200);
    const rows = await getDb().select().from(replies);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sentText).toBe(DM + " Cheers.");
    // M3: both sends are kept, append-only, oldest first.
    const sends = await getDb()
      .select()
      .from(replySends)
      .where(eq(replySends.replyId, rows[0]!.id))
      .orderBy(replySends.sentAt, replySends.id);
    expect(sends.map((x) => x.sentText)).toEqual([DM, DM + " Cheers."]);
    expect(
      sends.every((x) => x.draftId === draftId && x.userId === userId),
    ).toBe(true);
    expect(sends[0]!.editRatio).toBe(0);
  });

  it("two concurrent first sends: one is new, voice counted once (L5)", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    // Hold back inserts into replies (reads still pass) so all four requests get past any
    // "does it exist yet?" read before the first insert lands.
    const gate = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL });
    await gate.connect();
    await gate.query("begin");
    await gate.query("lock table replies in share row exclusive mode");
    const pending = Array.from({ length: 4 }, () =>
      send(cookie, { draftId, kind: "dm", sentText: DM }),
    );
    await new Promise((r) => setTimeout(r, 400));
    await gate.query("commit");
    await gate.end();
    const res = await Promise.all(pending);
    expect(res.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    const [v] = await getDb()
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId));
    expect(v!.sendsCounted).toBe(1);
    expect(await getDb().select().from(replySends)).toHaveLength(4);
  });

  it("a comment and a dm are separate rows", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    await send(cookie, { draftId, kind: "dm", sentText: DM });
    await send(cookie, {
      draftId,
      kind: "comment",
      sentText: "Sent you a DM.",
    });
    expect(await getDb().select().from(replies)).toHaveLength(2);
  });

  it("an empty AI text has no edit ratio", async () => {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    await getDb()
      .update(drafts)
      .set({ comment: "" })
      .where(eq(drafts.id, draftId));
    const body = await (
      await send(cookie, { draftId, kind: "comment", sentText: "Check DMs." })
    ).json();
    expect(body.editRatio).toBeNull();
  });
});

describe("PATCH /replies/:id", () => {
  async function sent() {
    const { cookie, userId } = await setup();
    const { draftId } = await draftFor(cookie, userId);
    const reply = await (
      await send(cookie, { draftId, kind: "dm", sentText: DM })
    ).json();
    return { cookie, id: reply.id as string };
  }

  it("23: hired with a rate stores status and an outcome with the rate", async () => {
    const { cookie, id } = await sent();
    const res = await patch(cookie, id, {
      status: "hired",
      agreedRateMinor: 4500,
      currency: "USD",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("hired");
    const o = await getDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.replyId, id));
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({
      type: "hired",
      agreedRateMinor: 4500,
      currency: "USD",
    });
  });

  it("24: a rate on no_reply is INVALID_INPUT", async () => {
    const { cookie, id } = await sent();
    const res = await patch(cookie, id, {
      status: "no_reply",
      agreedRateMinor: 4500,
      currency: "USD",
    });
    expect(res.status).toBe(400);
    expect(
      (await patch(cookie, id, { status: "hired", agreedRateMinor: 4500 }))
        .status,
    ).toBe(400);
  });

  it("the unpaid flag adds an unpaid outcome", async () => {
    const { cookie, id } = await sent();
    await patch(cookie, id, { status: "hired", unpaid: true });
    const o = await getDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.replyId, id));
    expect(o.map((r) => r.type).sort()).toEqual(["hired", "unpaid"]);
  });

  it("the unpaid flag twice adds one unpaid outcome (L4)", async () => {
    const { cookie, id } = await sent();
    await patch(cookie, id, { status: "hired", unpaid: true });
    await patch(cookie, id, { status: "hired", unpaid: true });
    await patch(cookie, id, { status: "lost", unpaid: true });
    const o = await getDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.replyId, id));
    expect(o.map((r) => r.type).sort()).toEqual(["hired", "lost", "unpaid"]);
  });

  it("repeating the same status adds no second outcome", async () => {
    const { cookie, id } = await sent();
    await patch(cookie, id, { status: "replied" });
    await patch(cookie, id, { status: "replied" });
    expect(await getDb().select().from(outcomes)).toHaveLength(1);
  });

  it("another user's reply is a 404 and 'sent' can't be set", async () => {
    const { cookie, id } = await sent();
    const other = await setup("b@example.com");
    expect((await patch(other.cookie, id, { status: "lost" })).status).toBe(
      404,
    );
    expect((await patch(cookie, id, { status: "sent" })).status).toBe(400);
  });
});

describe("GET /replies", () => {
  it("25: filters by status and paginates newest first", async () => {
    const { cookie, userId } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { draftId } = await draftFor(cookie, userId);
      const r = await (
        await send(cookie, { draftId, kind: "dm", sentText: DM })
      ).json();
      ids.push(r.id);
      await getDb()
        .update(replies)
        .set({ sentAt: new Date(Date.now() - (3 - i) * 60_000) })
        .where(eq(replies.id, r.id));
    }
    await patch(cookie, ids[0]!, { status: "lost" });

    const sentOnly = await (await list(cookie, "?status=sent")).json();
    expect(sentOnly.items.map((r: { id: string }) => r.id)).toEqual([
      ids[2],
      ids[1],
    ]);

    const p1 = await (await list(cookie, "?limit=2")).json();
    expect(p1.items.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await (
      await list(cookie, `?limit=2&cursor=${p1.nextCursor}`)
    ).json();
    expect(p2.items.map((r: { id: string }) => r.id)).toEqual([ids[0]]);
    expect(p2.nextCursor).toBeNull();
    expect(p1.items[0].post).toMatchObject({
      title: expect.any(String),
      community: "forhire",
    });
  });

  it("only shows the user's own replies and rejects a bad cursor", async () => {
    const a = await setup("a@example.com");
    const { draftId } = await draftFor(a.cookie, a.userId);
    await send(a.cookie, { draftId, kind: "dm", sentText: DM });
    const b = await setup("b@example.com");
    expect((await (await list(b.cookie)).json()).items).toEqual([]);
    expect((await list(b.cookie, "?cursor=zzz")).status).toBe(400);
  });
});
