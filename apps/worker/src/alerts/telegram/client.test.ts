import { describe, expect, it } from "vitest";
import {
  classifyTelegramError,
  createTelegramClient,
  TelegramError,
} from "./client";

const TOKEN = "123456:SECRET-token";

function fakeFetch(
  respond: (
    url: string,
    body: Record<string, unknown>,
  ) => Response | Promise<Response>,
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    return respond(url, body);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createTelegramClient", () => {
  it("sends HTML with previews off and the buttons", async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, { ok: true, result: { message_id: 9 } }),
    );
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const markup = { inline_keyboard: [[{ text: "Draft", url: "https://x" }]] };
    expect(
      await c.sendMessage({
        chatId: "42",
        text: "<b>hi</b>",
        replyMarkup: markup,
      }),
    ).toEqual({ messageId: 9 });
    expect(calls[0]!.url).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    );
    expect(calls[0]!.body).toEqual({
      chat_id: "42",
      text: "<b>hi</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
  });

  it("sendText sends plain text", async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, { ok: true, result: { message_id: 1 } }),
    );
    await createTelegramClient({ token: TOKEN, fetch: f }).sendText(
      "42",
      "a < b",
    );
    expect(calls[0]!.body.parse_mode).toBeUndefined();
    expect(calls[0]!.body.text).toBe("a < b");
  });

  it("long-polls getUpdates with the offset", async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, { ok: true, result: [{ update_id: 5 }] }),
    );
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    expect(await c.getUpdates({ offset: 5, timeoutSec: 30 })).toEqual([
      { update_id: 5 },
    ]);
    expect(calls[0]!.body).toEqual({
      offset: 5,
      timeout: 30,
      allowed_updates: ["message"],
    });
  });

  it("turns API errors into TelegramError with the retry hint", async () => {
    const { f } = fakeFetch(() =>
      json(429, {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 },
      }),
    );
    const err = await createTelegramClient({ token: TOKEN, fetch: f })
      .sendMessage({ chatId: "1", text: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(err).toMatchObject({
      status: 429,
      retryAfterSec: 7,
      method: "sendMessage",
    });
  });

  it("never puts the token in an error, even for network failures", async () => {
    const fail = (async (url: string) => {
      throw new TypeError(`fetch failed for ${url}`);
    }) as unknown as typeof fetch;
    const err = (await createTelegramClient({ token: TOKEN, fetch: fail })
      .sendMessage({ chatId: "1", text: "x" })
      .catch((e: unknown) => e)) as TelegramError;
    expect(err.status).toBe(0);
    const everything = JSON.stringify({
      ...err,
      message: err.message,
      stack: err.stack,
    });
    expect(everything).not.toContain("SECRET");
  });

  it("times out a hung request", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      })) as unknown as typeof fetch;
    const err = (await createTelegramClient({
      token: TOKEN,
      fetch: hang,
      timeoutMs: 50,
    })
      .sendMessage({ chatId: "1", text: "x" })
      .catch((e: unknown) => e)) as TelegramError;
    expect(err).toMatchObject({ status: 0, description: "timeout" });
  });

  it("handles a non-JSON error page", async () => {
    const { f } = fakeFetch(
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    );
    const err = await createTelegramClient({ token: TOKEN, fetch: f })
      .sendMessage({ chatId: "1", text: "x" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502 });
  });
});

describe("classifyTelegramError", () => {
  const e = (status: number, description = "", retry?: number) =>
    new TelegramError("sendMessage", status, description, retry);

  it("classifies each case", () => {
    expect(classifyTelegramError(e(429, "", 3))).toEqual({
      code: "RATE_LIMITED",
      retryable: true,
      countAttempt: false,
      retryInMs: 3000,
    });
    expect(
      classifyTelegramError(e(403, "Forbidden: bot was blocked by the user")),
    ).toEqual({
      code: "TG_BLOCKED",
      retryable: false,
      countAttempt: true,
      disable: true,
    });
    expect(
      classifyTelegramError(e(400, "Bad Request: chat not found")),
    ).toMatchObject({
      code: "TG_CHAT_NOT_FOUND",
      disable: true,
      retryable: false,
    });
    expect(
      classifyTelegramError(e(400, "Bad Request: can't parse entities")),
    ).toEqual({
      code: "TG_BAD_REQUEST",
      retryable: false,
      countAttempt: true,
    });
    expect(classifyTelegramError(e(401))).toMatchObject({
      code: "TG_UNAUTHORIZED",
      retryable: true,
      countAttempt: false,
    });
    for (const s of [0, 500, 502]) {
      expect(classifyTelegramError(e(s))).toEqual({
        code: "TG_UNAVAILABLE",
        retryable: true,
        countAttempt: true,
      });
    }
    expect(classifyTelegramError(new Error("x")).code).toBe("TG_UNAVAILABLE");
  });
});
