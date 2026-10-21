import { createDb } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAlertsFromEnv, type AlertsEnv } from "./index";
import type { TelegramClient } from "./telegram/client";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 4 });
beforeAll(() => runMigrations(url));
afterAll(() => pool.end());

const baseEnv: AlertsEnv = {
  DATABASE_URL: url,
  ALERTS_ENABLED: true,
  TELEGRAM_MAX_PER_SECOND: 25,
  ALERT_MAX_AGE_HOURS: 24,
};

function setup() {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const log = pino(
    { level: "info" },
    {
      write(chunk: string) {
        const o = JSON.parse(chunk);
        lines.push({ obj: o, msg: o.msg });
      },
    },
  );
  const channels: string[] = [];
  const listen = async (channel: string) => {
    channels.push(channel);
    return { onNotify() {}, async close() {} };
  };
  const getUpdates = vi.fn(
    (opts: { signal?: AbortSignal }) =>
      new Promise<never[]>((resolve) => {
        opts.signal?.addEventListener("abort", () => resolve([]));
      }),
  );
  const client = {
    getUpdates,
    sendMessage: vi.fn(),
    sendText: vi.fn(),
  } as unknown as TelegramClient;
  const acquireLock = vi.fn(async () => null);
  return { lines, log, channels, listen, client, acquireLock, getUpdates };
}

describe("createAlertsFromEnv", () => {
  it("1: returns null when ALERTS_ENABLED is false", () => {
    const t = setup();
    expect(
      createAlertsFromEnv(
        { ...baseEnv, ALERTS_ENABLED: false },
        { db, log: t.log },
      ),
    ).toBeNull();
  });

  it("2: without a token only the router runs, and the log says why", async () => {
    const t = setup();
    const alerts = createAlertsFromEnv(baseEnv, {
      db,
      log: t.log,
      listen: t.listen,
      client: t.client,
      acquireLock: t.acquireLock,
    })!;
    await alerts.start();
    await alerts.stop();
    expect(t.channels).toEqual(["match_alerts"]);
    expect(t.acquireLock).not.toHaveBeenCalled();
    const started = t.lines.find((l) => /alerts started/.test(l.msg))!;
    expect(started.msg).toContain("no TELEGRAM_BOT_TOKEN");
    expect(started.obj).toMatchObject({ sender: false, bot: false });
  });

  it("3: with a token the router, sender and bot all start, and the token is never logged", async () => {
    const t = setup();
    const token = "123456789:AAH_abcdefghijklmnopqrstuvwxyz0123456";
    const alerts = createAlertsFromEnv(
      {
        ...baseEnv,
        TELEGRAM_BOT_TOKEN: token,
        APP_ORIGIN: "http://localhost:3000",
      },
      {
        db,
        log: t.log,
        listen: t.listen,
        client: t.client,
        acquireLock: t.acquireLock,
      },
    )!;
    await alerts.start();
    await vi.waitFor(() => expect(t.acquireLock).toHaveBeenCalled());
    await alerts.stop();
    expect(t.channels.sort()).toEqual(["alerts", "match_alerts"]);
    const started = t.lines.find((l) => /alerts started/.test(l.msg))!;
    expect(started.obj).toMatchObject({
      router: true,
      sender: true,
      bot: true,
    });
    expect(JSON.stringify(t.lines)).not.toContain(token);
  });

  it("4: refuses a token without APP_ORIGIN", () => {
    const t = setup();
    expect(() =>
      createAlertsFromEnv(
        { ...baseEnv, TELEGRAM_BOT_TOKEN: "1:" + "a".repeat(30) },
        { db, log: t.log, listen: t.listen, client: t.client },
      ),
    ).toThrow(/APP_ORIGIN/);
  });
});
