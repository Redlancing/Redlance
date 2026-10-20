// A thin Telegram Bot API client (two methods don't need a library). The token is part of
// every URL, so errors never carry the URL or the underlying fetch message: method, status
// and Telegram's error code only.
import type { DeliveryFailure } from "@redlance/db";

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
};

export type InlineKeyboard = {
  inline_keyboard: { text: string; url: string }[][];
};

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    /** HTTP status; 0 for a network error or timeout. */
    readonly status: number,
    /** Telegram's description, e.g. "Bad Request: chat not found". Never contains the token. */
    readonly description: string,
    readonly retryAfterSec?: number,
  ) {
    super(`telegram ${method} failed: ${status}`);
    this.name = "TelegramError";
  }
}

export type TelegramClient = {
  sendMessage(msg: {
    chatId: string;
    text: string;
    replyMarkup?: InlineKeyboard;
  }): Promise<{ messageId: number }>;
  /** Long poll: resolves after `timeoutSec` with no updates, or as soon as one arrives. */
  getUpdates(opts: {
    offset?: number;
    timeoutSec?: number;
    signal?: AbortSignal;
  }): Promise<TelegramUpdate[]>;
  /** A plain reply from the bot (no HTML). */
  sendText(chatId: string, text: string): Promise<{ messageId: number }>;
};

export function createTelegramClient(opts: {
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  apiBase?: string;
}): TelegramClient {
  const doFetch = opts.fetch ?? fetch;
  const base = `${opts.apiBase ?? "https://api.telegram.org"}/bot${opts.token}`;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call<T>(
    method: string,
    body: Record<string, unknown>,
    ms: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(ms);
    let res: Response;
    try {
      res = await doFetch(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      // Network error, timeout or abort. The original error can quote the URL (and token).
      throw new TelegramError(
        method,
        0,
        timeout.aborted ? "timeout" : "network error",
      );
    }
    let json: {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      // Not JSON (a proxy error page): classified by status alone.
    }
    if (res.ok && json.ok) return json.result as T;
    throw new TelegramError(
      method,
      res.status,
      String(json.description ?? "").slice(0, 200),
      json.parameters?.retry_after,
    );
  }

  return {
    async sendMessage({ chatId, text, replyMarkup }) {
      const r = await call<{ message_id: number }>(
        "sendMessage",
        {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
        timeoutMs,
      );
      return { messageId: r.message_id };
    },
    async getUpdates({ offset, timeoutSec = 30, signal }) {
      return call<TelegramUpdate[]>(
        "getUpdates",
        {
          ...(offset !== undefined ? { offset } : {}),
          timeout: timeoutSec,
          allowed_updates: ["message"],
        },
        (timeoutSec + 10) * 1000,
        signal,
      );
    },
    async sendText(chatId, text) {
      const r = await call<{ message_id: number }>(
        "sendMessage",
        { chat_id: chatId, text, link_preview_options: { is_disabled: true } },
        timeoutMs,
      );
      return { messageId: r.message_id };
    },
  };
}

export type TelegramFailure = DeliveryFailure & {
  /** Turn the user's Telegram channel off: they blocked the bot or the chat is gone. */
  disable?: boolean;
};

/** How the sender treats a failed send. */
export function classifyTelegramError(err: unknown): TelegramFailure {
  if (!(err instanceof TelegramError)) {
    return { code: "TG_UNAVAILABLE", retryable: true, countAttempt: true };
  }
  if (err.status === 429) {
    return {
      code: "RATE_LIMITED",
      retryable: true,
      countAttempt: false,
      retryInMs: Math.max(1, err.retryAfterSec ?? 5) * 1000,
    };
  }
  if (err.status === 403) {
    return {
      code: "TG_BLOCKED",
      retryable: false,
      countAttempt: true,
      disable: true,
    };
  }
  if (err.status === 400 && /chat not found/i.test(err.description)) {
    return {
      code: "TG_CHAT_NOT_FOUND",
      retryable: false,
      countAttempt: true,
      disable: true,
    };
  }
  if (err.status === 400) {
    return { code: "TG_BAD_REQUEST", retryable: false, countAttempt: true };
  }
  // A bad token is our configuration, not the message's fault: keep the message.
  if (err.status === 401 || err.status === 404) {
    return { code: "TG_UNAUTHORIZED", retryable: true, countAttempt: false };
  }
  return { code: "TG_UNAVAILABLE", retryable: true, countAttempt: true };
}
