import { matchEvents, matches } from "@redlance/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { decodeCursor, encodeCursor } from "@/server/feed";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import {
  clearPosts,
  finishAi,
  seedMatch,
  seedPost,
} from "../../../../../test/feed-fixtures";
import { TEST_ENV } from "../../../../../test/test-env";
import { users } from "@redlance/db";
import { GET as getFeed } from "./route";
import { GET as getOne } from "./[matchId]/route";
import { POST as postStatus } from "./[matchId]/status/route";

beforeEach(async () => {
  await resetState();
  await clearPosts();
});
afterAll(closeAll);

const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H);

async function userIdOf(email: string): Promise<string> {
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return u!.id;
}

async function setup(email = "dev@example.com") {
  const cookie = await cookieFor(email);
  return { cookie, userId: await userIdOf(email) };
}

const get = (cookie: string, qs = "") =>
  getFeed(req(`/api/v1/feed${qs}`, { headers: { cookie } }));

const post = (
  matchId: string,
  body: unknown,
  headers: Record<string, string>,
) =>
  postStatus(
    req(`/api/v1/feed/${matchId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ matchId }) },
  );

async function seedFive(userId: string) {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++)
    ids.push(await seedMatch(userId, await seedPost({ postedAt: ago(i + 1) })));
  return ids;
}

describe("GET /api/v1/feed", () => {
  it("1: 401 signed out", async () => {
    expect((await getFeed(req("/api/v1/feed"))).status).toBe(401);
  });

  it("2: empty feed", async () => {
    const { cookie } = await setup();
    const res = await get(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("3: best vs all, newest post first", async () => {
    const { cookie, userId } = await setup();
    await seedMatch(userId, await seedPost({ postedAt: ago(3) }), {
      ruleScore: 85,
    });
    await seedMatch(userId, await seedPost({ postedAt: ago(1) }), {
      ruleScore: 62,
    });
    await seedMatch(userId, await seedPost({ postedAt: ago(2) }), {
      ruleScore: 40,
    });
    const best = await (await get(cookie)).json();
    expect(best.items.map((i: { score: number }) => i.score)).toEqual([62, 85]);
    const all = await (await get(cookie, "?view=all")).json();
    expect(all.items.map((i: { score: number }) => i.score)).toEqual([
      62, 40, 85,
    ]);
  });

  it("4: pages with a cursor, no overlap", async () => {
    const { cookie, userId } = await setup();
    await seedFive(userId);
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 5; n++) {
      const qs: string = `?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const body: { items: { matchId: string }[]; nextCursor: string | null } =
        await (await get(cookie, qs)).json();
      sizes.push(body.items.length);
      seen.push(...body.items.map((i) => i.matchId));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(5);
  });

  it("5: bad cursors give 400", async () => {
    const { cookie } = await setup();
    const id = "0199c1c2-0000-7000-8000-000000000000";
    const bad = [
      "garbage",
      Buffer.from("nope").toString("base64url"),
      Buffer.from(`not-a-date|${id}`).toString("base64url"),
      Buffer.from(`${new Date().toISOString()}|not-a-uuid`).toString(
        "base64url",
      ),
    ];
    for (const c of bad) {
      const res = await get(cookie, `?cursor=${c}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_INPUT");
    }
  });

  it("6: type filter", async () => {
    const { cookie, userId } = await setup();
    await seedMatch(userId, await seedPost({ categories: ["design"] }));
    await seedMatch(userId, await seedPost({ categories: ["development"] }));
    const body = await (await get(cookie, "?type=design")).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].post.categories).toEqual(["design"]);
  });

  it("7: unknown type, or more than 3, gives 400", async () => {
    const { cookie } = await setup();
    expect((await get(cookie, "?type=nope")).status).toBe(400);
    expect(
      (await get(cookie, "?type=design,video,writing,development")).status,
    ).toBe(400);
  });

  it("8: pay=paid", async () => {
    const { cookie, userId } = await setup();
    await seedMatch(userId, await seedPost({ payType: "paid" }));
    await seedMatch(userId, await seedPost({ payType: "unpaid" }));
    const body = await (await get(cookie, "?pay=paid")).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].post.payType).toBe("paid");
  });

  it("9: dismissed matches are hidden", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    await seedMatch(userId, await seedPost());
    await getDb()
      .update(matches)
      .set({ status: "dismissed" })
      .where(eq(matches.id, id));
    for (const view of ["best", "all"]) {
      const body = await (await get(cookie, `?view=${view}`)).json();
      expect(body.items).toHaveLength(1);
    }
  });

  it("10: response shape, no internal fields, ISO dates", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(
      userId,
      await seedPost({
        budget: { min: 300, max: 500, currency: "USD", unit: "fixed" },
      }),
    );
    await finishAi(id, userId, { aiScore: 90, aiReason: "Great fit" });
    const text = await (await get(cookie)).text();
    expect(text).not.toMatch(
      /features|ai_error|aiError|SECRET_INTERNAL|aiConcerns/,
    );
    const item = JSON.parse(text).items[0];
    expect(Object.keys(item).sort()).toEqual(
      [
        "aiStatus",
        "bestProject",
        "bestRole",
        "broad",
        "matchId",
        "post",
        "reason",
        "score",
        "status",
      ].sort(),
    );
    expect(Object.keys(item.post).sort()).toEqual(
      [
        "alsoPostedIn",
        "applyInstructions",
        "budget",
        "categories",
        "community",
        "deadline",
        "id",
        "payType",
        "postedAt",
        "redFlags",
        "remote",
        "summary",
        "title",
        "url",
      ].sort(),
    );
    expect(item.post.budget).toEqual({
      min: 300,
      max: 500,
      currency: "USD",
      unit: "fixed",
    });
    expect(new Date(item.post.postedAt).toISOString()).toBe(item.post.postedAt);
    // An analysis without instructions (all old rows) gives null.
    expect(item.post.applyInstructions).toBeNull();
  });

  it("applyInstructions are passed through", async () => {
    const { cookie, userId } = await setup();
    await seedMatch(
      userId,
      await seedPost({ applyInstructions: "DM only, include your rate" }),
    );
    const body = await (await get(cookie)).json();
    expect(body.items[0].post.applyInstructions).toBe(
      "DM only, include your rate",
    );
  });

  it("11: alsoPostedIn lists duplicate communities", async () => {
    const { cookie, userId } = await setup();
    const original = await seedPost({ community: "forhire" });
    await seedPost({ community: "hiring", duplicateOf: original });
    await seedPost({ community: "DesignJobs", duplicateOf: original });
    await seedMatch(userId, original);
    const body = await (await get(cookie)).json();
    expect(body.items[0].post.alsoPostedIn).toEqual(["DesignJobs", "hiring"]);
  });

  it("12: AI done uses the AI reason and project", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost(), {
      aiStatus: "pending",
    });
    const projectId = await finishAi(id, userId, {
      aiScore: 91,
      aiReason: "Your bakery site is the same shape",
      projectTitle: "Bakery site",
    });
    const item = (await (await get(cookie)).json()).items[0];
    expect(item.reason).toBe("Your bakery site is the same shape");
    expect(item.aiStatus).toBe("done");
    expect(item.score).toBe(91);
    expect(item.bestProject).toEqual({ id: projectId, title: "Bakery site" });
  });

  it("13: without AI the rule reason shows", async () => {
    const { cookie, userId } = await setup();
    await seedMatch(userId, await seedPost(), { aiStatus: "pending" });
    const item = (await (await get(cookie)).json()).items[0];
    expect(item.reason).toBe("Rule reason");
    expect(item.aiStatus).toBe("pending");
    expect(item.bestProject).toBeNull();
  });

  it("does not show another user's matches", async () => {
    const a = await setup("a@example.com");
    const b = await setup("b@example.com");
    await seedMatch(a.userId, await seedPost());
    expect((await (await get(b.cookie)).json()).items).toEqual([]);
  });
});

describe("POST /api/v1/feed/:matchId/status", () => {
  const headers = (cookie: string) => ({ cookie, origin: TEST_ENV.APP_ORIGIN });

  it("14: saves and logs one event", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    const res = await post(id, { status: "saved" }, headers(cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "saved" });
    const [row] = await getDb()
      .select()
      .from(matches)
      .where(eq(matches.id, id));
    expect(row!.status).toBe("saved");
    const events = await getDb()
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, id));
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("saved");
  });

  it("15: another user's match is 404", async () => {
    const a = await setup("a@example.com");
    const b = await setup("b@example.com");
    const id = await seedMatch(a.userId, await seedPost());
    expect(
      (await post(id, { status: "saved" }, headers(b.cookie))).status,
    ).toBe(404);
  });

  it("16: non-uuid matchId is 404", async () => {
    const { cookie } = await setup();
    expect(
      (await post("not-a-uuid", { status: "saved" }, headers(cookie))).status,
    ).toBe(404);
  });

  it("17: unknown status is 400", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    for (const status of ["archived", "new"])
      expect((await post(id, { status }, headers(cookie))).status).toBe(400);
  });

  it("18: no Origin is 403", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    const res = await post(id, { status: "saved" }, { cookie });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("onlyIfNew marks a new match seen", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    const res = await post(
      id,
      { status: "seen", onlyIfNew: true },
      headers(cookie),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "seen" });
  });

  it("onlyIfNew leaves a saved match saved and returns its status", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    await post(id, { status: "saved" }, headers(cookie));
    const res = await post(
      id,
      { status: "seen", onlyIfNew: true },
      headers(cookie),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "saved" });
    const [row] = await getDb()
      .select()
      .from(matches)
      .where(eq(matches.id, id));
    expect(row!.status).toBe("saved");
    const events = await getDb()
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, id));
    expect(events).toHaveLength(1);
  });

  it("onlyIfNew works only with seen; another user's match is 404", async () => {
    const a = await setup("a@example.com");
    const b = await setup("b@example.com");
    const id = await seedMatch(a.userId, await seedPost());
    expect(
      (await post(id, { status: "saved", onlyIfNew: true }, headers(a.cookie)))
        .status,
    ).toBe(400);
    expect(
      (await post(id, { status: "seen", onlyIfNew: true }, headers(b.cookie)))
        .status,
    ).toBe(404);
  });

  it("19: signed out is 401", async () => {
    const { userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    const res = await post(
      id,
      { status: "saved" },
      { origin: TEST_ENV.APP_ORIGIN },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/feed/:matchId", () => {
  const one = (matchId: string, cookie?: string) =>
    getOne(
      req(`/api/v1/feed/${matchId}`, { headers: cookie ? { cookie } : {} }),
      { params: Promise.resolve({ matchId }) },
    );

  it("returns the match with the post body and the withdrawn flag", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    const res = await one(id, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchId).toBe(id);
    expect(body.withdrawn).toBe(false);
    expect(typeof body.post.body).toBe("string");
    expect(body.post.postedAt).toMatch(/Z$/);
    // Same fields as a feed item, plus the two extras.
    const feed = await (await get(cookie, "?view=all")).json();
    const item = structuredClone(body);
    delete item.withdrawn;
    delete item.post.body;
    expect(feed.items[0]).toEqual(item);
  });

  it("dismissed matches still open", async () => {
    const { cookie, userId } = await setup();
    const id = await seedMatch(userId, await seedPost());
    await post(
      id,
      { status: "dismissed" },
      { cookie, origin: TEST_ENV.APP_ORIGIN },
    );
    const res = await one(id, cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("dismissed");
  });

  it("another user's match, a bad id, or signed out", async () => {
    const a = await setup("a@example.com");
    const b = await setup("b@example.com");
    const id = await seedMatch(a.userId, await seedPost());
    expect((await one(id, b.cookie)).status).toBe(404);
    expect((await one("not-a-uuid", a.cookie)).status).toBe(404);
    expect((await one(id)).status).toBe(401);
  });
});

describe("cursor", () => {
  it("20: round trip", () => {
    const c = {
      postedAt: new Date("2026-10-01T12:34:56.789Z"),
      id: "0199c1c2-0000-7000-8000-000000000000",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("")).toBeNull();
  });
});
