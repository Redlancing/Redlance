# Phase 5: Telegram (client, sender, linking bot)

Model: **Opus** (rate limits, retries, at-least-once) · Runs after Phase 4

## Why

Telegram is the instant channel and the product's speed promise. It has hard limits (about 30 messages a second per bot, 1 a second per chat, confirmed in the Bot FAQ on 2026-10-20), so the sender paces itself instead of hitting 429s.

## Files

### `apps/worker/src/alerts/telegram/client.ts` (new)

A thin `fetch` wrapper; no Telegram library (two methods don't need one).

- `createTelegramClient({ token, fetch?, timeoutMs = 10_000 })`:
  - `sendMessage({ chatId, text, replyMarkup }) → { messageId }`: `parse_mode: "HTML"`, `link_preview_options: { is_disabled: true }`;
  - `getUpdates({ offset, timeoutSec = 30 }) → Update[]` (long poll; its HTTP timeout is `timeoutSec + 10` s);
  - `sendText(chatId, text)` for bot replies.
- `classifyTelegramError(status, body) → { code, retryable, countAttempt, retryInMs?, disable? }` (the sender passes `disable` to `disableChannel(user, 'telegram', 'blocked')`):
  - 429 → `RATE_LIMITED`, retry after `parameters.retry_after` s, `countAttempt: false`;
  - 403 → `TG_BLOCKED`, final, disable the channel;
  - 400 with "chat not found" → `TG_CHAT_NOT_FOUND`, final, disable;
  - other 400 → `TG_BAD_REQUEST`, final (a bug in our message; logged as an error);
  - 5xx, network, timeout → `TG_UNAVAILABLE`, retryable.
- The token is never logged; errors log the method and status only.

### `apps/worker/src/alerts/pace.ts` (new)

- `createRateLimiter({ perSecond })`: a token bucket; `take()` resolves when a token is free; `pauseFor(ms)` (after a 429) blocks every taker.
- `createPerKeySpacing(minGapMs)`: `wait(key)` so one chat gets at most one message per 1.1 s; entries older than a minute are dropped.

### `apps/worker/src/alerts/telegram/sender.ts` (new)

`createTelegramSender(deps) → { start, stop, idle }`:

- LISTEN `alerts`, poll every 5 s, stale sweep every 60 s (`requeueStaleDeliveries`);
- `claimDueDeliveries(db, 'telegram', { maxUsers: 25, perUser: 5 })`;
- per group (up to 25 groups in flight): `telegramAlert(items, appOrigin)` → `limiter.take()` → `spacing.wait(chatId)` → `sendMessage` → `completeDeliveries` (template `tg@1`, the message id); on error `classifyTelegramError` → `failDeliveries` and, when `disable`, `disableChannel(user, 'telegram', 'blocked')`; on 429 `limiter.pauseFor`;
- a circuit breaker like the drafter's: 5 `TG_UNAVAILABLE` in a row → pause claiming 1 min × 2^n, max 15 min;
- stop(): stop claiming, wait for in-flight sends (max 10 s), give unsent claimed rows back (`countAttempt: false`, retry now).

### `apps/worker/src/alerts/telegram/bot.ts` (new)

`createTelegramBot(deps) → { start, stop }`, run only while holding the advisory lock `redlance:telegram-bot` (`acquireSessionLock`, like the Reddit poller; a second worker stands by):

- loop `getUpdates({ offset })`; keep `offset = last update_id + 1` in memory (Telegram keeps unconfirmed updates for 24 h, so a restart re-reads a few, which is harmless: link tokens are single use);
- `/start <token>` → `useTelegramLinkToken(sha256(token), chatId)` → reply "Connected…" or "This link has expired…";
- `/start` with no token → reply with how to connect from the app;
- `/stop` → `disableTelegramByChat(chatId, 'user_stop')` → "Alerts are off. Turn them back on in Redlance.";
- anything else → a one-line help reply, at most once per chat per hour (spacing map);
- ignores group chats (alerts are private only);
- on network errors: back off 1 s × 2^n up to 60 s.

## Tests (write first)

With a fake `fetch` (no real Telegram):

- `client.test.ts`: request shape (HTML mode, previews off, buttons), each error class, timeout, the token never appears in an error message;
- `pace.test.ts`: 25/s bucket with a fake clock, `pauseFor`, per-chat spacing;
- `sender.test.ts` (real Postgres): one match → one message and the row deleted; 3 matches for one user → one combined message, all three matches updated with the same message id; 429 → retry after `retry_after` without using an attempt; 403 → channel disabled and the user's other pending Telegram rows failed; 5 failures → `failed`; crash between send and complete → the stale sweep resends (documented duplicate);
- `bot.test.ts`: link success, expired token, reused token, `/stop`, group chat ignored, offset advances, two bots → only the lock holder polls.

## Live check (needs you)

1. In Telegram, message @BotFather → `/newbot` → name "Redlance (dev)" → copy the token.
2. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in `apps/worker/.env.local` (gitignored).
3. Start the worker, create a link token for the dev user (a small dev script, or the Phase 6 route once built), tap the link, press Start, check the channel row, then insert a test match and see the alert arrive.

## Done when

Tests green; a real alert reached a real Telegram chat on the dev bot.
