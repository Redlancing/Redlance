import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alertChannels, telegramLinkTokens } from "@redlance/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import { seedDraftUser, userIdOf } from "../../../../../test/draft-fixtures";
import { TEST_ENV } from "../../../../../test/test-env";
import { DELETE as unlinkRoute } from "./telegram/route";
import { POST as linkRoute } from "./telegram/link/route";
import {
  GET as getSettingsRoute,
  PATCH as patchSettingsRoute,
} from "./settings/route";

// The bot username is read through getEnv(); tests flip it here.
let botUsername: string | undefined = "redlance_test_bot";
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), TELEGRAM_BOT_USERNAME: botUsername }),
  };
});

beforeEach(async () => {
  botUsername = "redlance_test_bot";
  await resetState();
});
afterAll(closeAll);

async function onboarded(email = "dev@example.com") {
  const cookie = await cookieFor(email);
  const userId = await userIdOf(email);
  await seedDraftUser(userId);
  return { cookie, userId };
}

const getSettings = (cookie?: string) =>
  getSettingsRoute(
    req("/api/v1/alerts/settings", { headers: cookie ? { cookie } : {} }),
  );
const patch = (cookie: string, body: unknown, origin = true) =>
  patchSettingsRoute(
    req("/api/v1/alerts/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie,
        ...(origin ? { origin: TEST_ENV.APP_ORIGIN } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const link = (cookie: string) =>
  linkRoute(
    req("/api/v1/alerts/telegram/link", {
      method: "POST",
      headers: { cookie, origin: TEST_ENV.APP_ORIGIN },
    }),
  );
const unlink = (cookie: string) =>
  unlinkRoute(
    req("/api/v1/alerts/telegram", {
      method: "DELETE",
      headers: { cookie, origin: TEST_ENV.APP_ORIGIN },
    }),
  );

async function seedChannel(userId: string, over: object = {}) {
  await getDb()
    .insert(alertChannels)
    .values({
      userId,
      kind: "telegram",
      target: "123456789",
      enabled: true,
      verifiedAt: new Date(),
      ...over,
    });
}

describe("GET /api/v1/alerts/settings", () => {
  it("401s when signed out", async () => {
    expect((await getSettings()).status).toBe(401);
  });

  it("returns the defaults after onboarding, with Telegram not linked", async () => {
    const { cookie } = await onboarded();
    const res = await getSettings(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      minScore: 70,
      dailyCap: 20,
      telegram: { linked: false, enabled: false, disabledReason: null },
    });
  });

  it("403s a user who hasn't finished onboarding", async () => {
    const cookie = await cookieFor("new@example.com");
    expect((await getSettings(cookie)).status).toBe(403);
  });

  it("shows the channel's state and never the chat id", async () => {
    const { cookie, userId } = await onboarded();
    await seedChannel(userId);
    const body = await (await getSettings(cookie)).json();
    expect(body.telegram).toEqual({
      linked: true,
      enabled: true,
      disabledReason: null,
    });
    expect(JSON.stringify(body)).not.toContain("123456789");

    await getDb()
      .update(alertChannels)
      .set({ enabled: false, disabledReason: "blocked" });
    expect((await (await getSettings(cookie)).json()).telegram).toEqual({
      linked: true,
      enabled: false,
      disabledReason: "blocked",
    });
  });

  it("never shows another user's data", async () => {
    const a = await onboarded("a@example.com");
    const b = await onboarded("b@example.com");
    await seedChannel(a.userId);
    await patch(a.cookie, { minScore: 90 });
    const body = await (await getSettings(b.cookie)).json();
    expect(body.minScore).toBe(70);
    expect(body.telegram.linked).toBe(false);
  });
});

describe("PATCH /api/v1/alerts/settings", () => {
  it("updates one or both fields and returns the new settings", async () => {
    const { cookie } = await onboarded();
    let res = await patch(cookie, { minScore: 85 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ minScore: 85, dailyCap: 20 });
    res = await patch(cookie, { minScore: 0, dailyCap: 100 });
    expect(await res.json()).toMatchObject({ minScore: 0, dailyCap: 100 });
    expect((await (await getSettings(cookie)).json()).dailyCap).toBe(100);
  });

  it("accepts an empty patch as a no-op", async () => {
    const { cookie } = await onboarded();
    const res = await patch(cookie, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ minScore: 70, dailyCap: 20 });
  });

  it.each([
    { minScore: -1 },
    { minScore: 101 },
    { minScore: 70.5 },
    { minScore: "80" },
    { dailyCap: 0 },
    { dailyCap: 101 },
    { dailyCap: 1.5 },
    { other: 1 },
  ])("400s %j", async (body) => {
    const { cookie } = await onboarded();
    const res = await patch(cookie, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("403s without the origin header, 401s signed out", async () => {
    const { cookie } = await onboarded();
    expect((await patch(cookie, { minScore: 80 }, false)).status).toBe(403);
    expect((await patch("", { minScore: 80 })).status).toBe(401);
  });

  it("403s a user who hasn't finished onboarding", async () => {
    const cookie = await cookieFor("new@example.com");
    expect((await patch(cookie, { minScore: 80 })).status).toBe(403);
  });

  it("only changes the caller's profile", async () => {
    const a = await onboarded("a@example.com");
    const b = await onboarded("b@example.com");
    await patch(a.cookie, { minScore: 95, dailyCap: 3 });
    expect(await (await getSettings(b.cookie)).json()).toMatchObject({
      minScore: 70,
      dailyCap: 20,
    });
  });

  it("rate-limits at 20 a minute", async () => {
    const { cookie } = await onboarded();
    for (let i = 0; i < 20; i++)
      expect((await patch(cookie, { minScore: 50 })).status).toBe(200);
    const res = await patch(cookie, { minScore: 50 });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/v1/alerts/telegram/link", () => {
  it("returns a t.me deep link and stores only the token's hash, expiring in 15 minutes", async () => {
    const { cookie, userId } = await onboarded();
    const res = await link(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const m =
      /^https:\/\/t\.me\/redlance_test_bot\?start=([A-Za-z0-9_-]{43})$/.exec(
        body.url,
      );
    expect(m).not.toBeNull();
    const token = m![1]!;

    const rows = await getDb().select().from(telegramLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.usedAt).toBeNull();

    const ms = new Date(body.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    expect(rows[0]!.expiresAt.toISOString()).toBe(body.expiresAt);
  });

  it("gives a different token each time", async () => {
    const { cookie } = await onboarded();
    const a = (await (await link(cookie)).json()).url;
    const b = (await (await link(cookie)).json()).url;
    expect(a).not.toBe(b);
  });

  it("a new link invalidates the user's older unused links only", async () => {
    const a = await onboarded("a@example.com");
    const b = await onboarded("b@example.com");
    await link(a.cookie);
    await link(b.cookie);
    await link(a.cookie);
    const rows = await getDb().select().from(telegramLinkTokens);
    const mine = rows.filter((r) => r.userId === a.userId);
    expect(mine).toHaveLength(2);
    expect(mine.filter((r) => r.usedAt === null)).toHaveLength(1);
    const theirs = rows.filter((r) => r.userId === b.userId);
    expect(theirs.every((r) => r.usedAt === null)).toBe(true);
  });

  it("503s TELEGRAM_UNAVAILABLE when no bot username is set, and stores nothing", async () => {
    const { cookie } = await onboarded();
    botUsername = undefined;
    const res = await link(cookie);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("TELEGRAM_UNAVAILABLE");
    expect(await getDb().select().from(telegramLinkTokens)).toHaveLength(0);
  });

  it("401s signed out and 403s without the origin header", async () => {
    const { cookie } = await onboarded();
    expect(
      (
        await linkRoute(
          req("/api/v1/alerts/telegram/link", {
            method: "POST",
            headers: { origin: TEST_ENV.APP_ORIGIN },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await linkRoute(
          req("/api/v1/alerts/telegram/link", {
            method: "POST",
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("rate-limits at 5 a minute", async () => {
    const { cookie } = await onboarded();
    for (let i = 0; i < 5; i++) expect((await link(cookie)).status).toBe(200);
    const res = await link(cookie);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("DELETE /api/v1/alerts/telegram", () => {
  it("turns the channel off with reason user_stop, and again is a no-op", async () => {
    const { cookie, userId } = await onboarded();
    await seedChannel(userId);
    expect((await unlink(cookie)).status).toBe(200);
    const [ch] = await getDb()
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, userId));
    expect(ch).toMatchObject({ enabled: false, disabledReason: "user_stop" });

    expect((await unlink(cookie)).status).toBe(200);
    expect((await (await getSettings(cookie)).json()).telegram).toEqual({
      linked: true,
      enabled: false,
      disabledReason: "user_stop",
    });
  });

  it("also kills the user's unused link tokens, not another user's", async () => {
    const a = await onboarded("a@example.com");
    const b = await onboarded("b@example.com");
    await link(a.cookie);
    await link(b.cookie);
    await unlink(a.cookie);
    const rows = await getDb().select().from(telegramLinkTokens);
    expect(rows.find((r) => r.userId === a.userId)!.usedAt).not.toBeNull();
    expect(rows.find((r) => r.userId === b.userId)!.usedAt).toBeNull();
  });

  it("succeeds when Telegram was never linked", async () => {
    const { cookie } = await onboarded();
    expect((await unlink(cookie)).status).toBe(200);
    expect(await getDb().select().from(alertChannels)).toHaveLength(0);
  });

  it("leaves another user's channel alone", async () => {
    const a = await onboarded("a@example.com");
    const b = await onboarded("b@example.com");
    await seedChannel(a.userId);
    await seedChannel(b.userId, { target: "987654321" });
    await unlink(a.cookie);
    const [bch] = await getDb()
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, b.userId));
    expect(bch!.enabled).toBe(true);
  });

  it("401s signed out and 403s without the origin header", async () => {
    const { cookie } = await onboarded();
    expect(
      (
        await unlinkRoute(
          req("/api/v1/alerts/telegram", {
            method: "DELETE",
            headers: { origin: TEST_ENV.APP_ORIGIN },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await unlinkRoute(
          req("/api/v1/alerts/telegram", {
            method: "DELETE",
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("route registration", () => {
  it.each(["settings/route.ts", "telegram/route.ts", "telegram/link/route.ts"])(
    "%s wraps its handlers in apiRoute()",
    (file) => {
      const src = readFileSync(
        fileURLToPath(new URL(`./${file}`, import.meta.url)),
        "utf8",
      );
      const exported = src.match(/export const (GET|POST|PATCH|DELETE|PUT) =/g);
      expect(exported?.length).toBeGreaterThan(0);
      expect(src.match(/= apiRoute\(/g)?.length).toBe(exported!.length);
    },
  );
});
