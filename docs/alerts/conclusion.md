# Alerts (Telegram): conclusion

**Status (2026-10-20):**
- The whole backend is built: the router, the delivery queue, the Telegram sender, the linking bot, the web API, upkeep and two CLIs. There is **no UI yet** (API only).
- It lives in the working tree on `feat/alerts`. It is **not merged** into `main`.
- It was reviewed and the findings were fixed (M1, L1, L4, L5, L7, L8, L9 and the empty keyboard; see the build notes). L3 was fixed afterwards.
- Tests on feat/alerts after the review fixes (2026-10-20): core 318, db 335, worker 623, web 422 (llm unchanged at 26). Typecheck and lint clean.
- **Not run live yet.** It needs a dev bot token from @BotFather. The live-run steps are in `plan/07-wiring-ops.md`.
- Step 4 of the core loop (Alert) is done on the backend, for Telegram only. Email is deferred.

The spec is `README.md` in this folder, the phase log is `build-notes.md` and the phase plans are in `plan/`. They stay until the user has read this file. Where they differ from this file, this file (checked against the code) is right.

## In one paragraph

The matcher inserts a match for a new post and rings `match_alerts`. The **router** takes matches that have no alert outcome yet, runs the pure `decideAlert()` rules on each, writes the outcome on the match, and for a `queued` match inserts a row in `alert_deliveries`. The **sender** claims due deliveries, groups them per user (up to 5 per message), checks that its claim is still its own, and sends one Telegram message with link buttons. Success deletes the delivery rows and marks the matches `sent`. Failures retry with backoff or end as `failed`. A user connects Telegram with a one-time `t.me` link: the **bot** (long polling, one process at a time) turns `/start <token>` into a verified `alert_channels` row, and `/stop` turns alerts off. The queue is a Postgres table with `NOTIFY` as the bell and polling as the safety net. There is no SQS.

## The big picture

```
 matcher (matchPost)  ─► upsertMatches(rows, {origin: "post"}) ─► matches (alert_outcome null)
                                         │ NOTIFY match_alerts (only if a row was inserted)
                                         ▼
 worker  ROUTER   claim 200 unrouted (SKIP LOCKED) ─► per-user advisory lock
                  ─► count today's alerts ─► decideAlert() ─► write outcome on matches
                  ─► insert alert_deliveries for "queued" ─► NOTIFY alerts
                                         │
 worker  SENDER   claim due rows (grouped per user, max 5) ─► build message (tg@1)
                  ─► limiter + per-chat spacing ─► touchDeliveries (claim still ours?)
                  ─► sendMessage ─► completeDeliveries (delete rows, match = sent)
                  failure ─► failDeliveries (retry, final, or give back) · 403 ─► disableChannel
                  sweep every 60 s ─► requeueStaleDeliveries
 worker  BOT      advisory lock ─► getUpdates ─► /start <token> | /stop | help
 apps/web         GET/PATCH /alerts/settings · POST /alerts/telegram/link · DELETE /alerts/telegram
```

Everything runs in the one worker process. The web app only writes link tokens and settings; it never calls Telegram.

## Where the code is

| Part | Files |
|---|---|
| Pure rules (`@redlance/core`) | `packages/core/src/alerts/`: `constants.ts` (outcomes, statuses, disabled reasons, defaults, `TEMPLATE_VERSIONS`), `decide.ts` (`decideAlert`), `format.ts` (`telegramAlert`, `budgetLabel`, `appLinksUsable`, `alertLinks`, `escapeHtml`), `schedule.ts` (`startOfLocalDay`, `deliveryBackoffMs`) |
| Queue and storage | `packages/db/src/alerts.ts`: `withRoutingBatch`, `routedTodayCounts`, `claimDueDeliveries`, `completeDeliveries`, `touchDeliveries`, `failDeliveries`, `disableChannel`, `requeueStaleDeliveries`, `createTelegramLinkToken`, `useTelegramLinkToken`, `disableTelegramByChat`, `pruneAlerts`, `alertStats` |
| Matcher origin | `packages/db/src/matches.ts`: `upsertMatches(db, rows, { origin })`; callers are `matchPost` (`post`) and `runRematch` (`backfill`) in `apps/worker/src/match/matcher.ts` |
| Schema and migrations | `packages/db/src/schema.ts`; `migrations/0015_alerts.sql`, `0016_alert_relinked.sql` |
| Router | `apps/worker/src/alerts/router.ts` (`createRouter`) |
| Pacing | `apps/worker/src/alerts/pace.ts` (`createRateLimiter`, `createPerKeySpacing`, `Clock`) |
| Telegram | `apps/worker/src/alerts/telegram/`: `client.ts` (fetch client, `classifyTelegramError`), `sender.ts` (`createTelegramSender`), `bot.ts` (`createTelegramBot`, `BOT_REPLIES`), `test-fixtures.ts` |
| Wiring | `apps/worker/src/alerts/index.ts` (`createAlertsFromEnv`), `apps/worker/src/index.ts`, `env.ts`, `.env.example` |
| Upkeep | `apps/worker/src/ingest/upkeep.ts` (`prune-alerts` step) |
| CLIs | `apps/worker/src/cli/alerts-status.ts`, `apps/worker/scripts/alert-test.ts` |
| Web server code | `apps/web/src/server/alerts.ts` |
| Routes | `apps/web/src/app/api/v1/alerts/settings/route.ts`, `telegram/route.ts`, `telegram/link/route.ts` |
| Web settings | `apps/web/src/server/env.ts` (`TELEGRAM_BOT_USERNAME`), `errors.ts` (`TELEGRAM_UNAVAILABLE`, 503), `rate-limit/index.ts` (`alerts-settings`, `alerts-link`) |

## How it connects to the rest

| Feature | Link |
|---|---|
| Matching | `upsertMatches` now needs an `origin`. A new post's matches are inserted with `alert_outcome` null. An onboarding backfill's are inserted as `skipped_backfill`. An update (re-analysis) never touches the alert columns, so a match is decided once. New inserts are found with `xmax = 0`, and `NOTIFY match_alerts` fires only for a `post` batch that inserted at least one row. |
| Onboarding | Alerts need a profile (`alert_min_score`, `alerts_daily_cap`, `time_zone`, plan and trial end live there). A user with no profile is never alerted. Profile edits do not re-match, so they never alert. |
| Drafts | The "Draft reply" button links to `/feed/<matchId>`. That page is not built (see the gaps). |
| Ingestion | The upkeep job prunes old alert rows. |

## The tables and columns added

| Table | What it holds |
|---|---|
| `profiles` (changed) | `alert_min_score` (0 to 100, default 70), `alerts_daily_cap` (1 to 100, default 20) |
| `alert_channels` (existed, one new column) | `disabled_reason`: `blocked`, `user_stop` or `relinked` (null while enabled). `target` is the Telegram chat id. Unique on user and kind. |
| `matches` (changed) | `alert_outcome` (null = not routed yet), `alert_routed_at`, `alert_score` (the score at routing), `alerted_at`, `alert_channels` (text array, default empty), `alert_template` (`tg@1`), `telegram_message_id` (bigint) |
| `alert_deliveries` (new, the queue) | `id`, `user_id`, `match_id`, `channel` (`telegram`), `status` (`pending`, `sending`, `failed`), `attempts`, `run_after`, `locked_at`, `error_code`, `provider_message_id`, `created_at` |
| `telegram_link_tokens` (new) | `token_hash` (primary key, 64 lowercase hex), `user_id`, `expires_at`, `used_at`, `created_at` |

Outcomes on a match: `queued`, `sent`, `failed`, `below_threshold`, `skipped_backfill`, `skipped_stale`, `skipped_trial`, `skipped_cap`, `skipped_no_channel`, `skipped_withdrawn`. `queued`, `sent` and `failed` count toward the daily cap.

Constraints and indexes worth knowing:
- Every enum column has a CHECK constraint, and `alerts-schema.test.ts` keeps the lists in `schema.ts` equal to the ones in core.
- `alert_deliveries` is unique on (`match_id`, `channel`), so a match is queued once per channel.
- `token_hash` must be 64 hex characters, so a raw token can never be stored by mistake.
- Partial indexes: `matches_alert_route_idx` (only unrouted matches), `matches_user_routed_idx` (queued, sent, failed), `alert_deliveries_due_idx` (pending), `alert_deliveries_sending_idx` (sending). Plus `alert_deliveries_user_idx` and `telegram_link_tokens_user_idx`.
- Migration `0015` has one hand-added line: `UPDATE matches SET alert_outcome = 'skipped_backfill'`, so matches that exist when alerts ship never alert. `alerts-schema.test.ts` migrates a throwaway database from 0014 to 0015 to prove it.
- `0016` swaps the `disabled_reason` check to add `relinked`.

## The flow, step by step

### 1. A new post is matched

1. The matcher scores a new post and calls `upsertMatches(rows, { origin: "post" })`.
2. In the same transaction, if any row was really inserted, it runs `NOTIFY match_alerts`.

### 2. The router decides

3. The router wakes on `match_alerts` or on its 15 s poll. One pump runs at a time, with a run-again flag.
4. `withRoutingBatch` runs one transaction. It takes up to 200 matches with `alert_outcome is null` (oldest first, `FOR UPDATE SKIP LOCKED`), joined with the user, profile and Telegram channel.
5. It takes a `pg_advisory_xact_lock` for each user in the batch (users sorted, so two routers cannot deadlock). Then two routers cannot both take a user's last alert of the day.
6. It counts each user's `queued`, `sent` and `failed` matches since the start of their **local** day (`startOfLocalDay`, DST-safe, falls back to UTC for an unknown zone).
7. The router calls `decideAlert` for each match. The first rule that applies wins:

   | Order | Rule | Outcome |
   |---|---|---|
   | 0 | The user is blocked or has no profile (router, before `decideAlert`) | `skipped_no_channel` |
   | 1 | The match is withdrawn or its status is `dismissed` | `skipped_withdrawn` |
   | 2 | `score < alert_min_score` | `below_threshold` |
   | 3 | The post is older than `ALERT_MAX_AGE_HOURS` | `skipped_stale` |
   | 4 | Trial ended and no paid plan (`aiAllowed`) | `skipped_trial` |
   | 5 | The user already has `alerts_daily_cap` alerts today | `skipped_cap` |
   | 6 | No bot token, no channel, channel disabled or not verified | `skipped_no_channel` |
   | 7 | Otherwise | `queued`, channel `telegram` |

   Alerts queued earlier in the same batch count toward the cap.
8. In the same transaction it writes `alert_outcome`, `alert_routed_at` and `alert_score` on every match, inserts one delivery per queued match (`ON CONFLICT DO NOTHING`), and runs `NOTIFY alerts` if any row was inserted. A throw anywhere rolls the whole batch back and the next poll retries.
9. If the batch was full (200), it goes again at once. Routing 1,000 matches for 100 users took about 107 ms.

### 3. The sender sends

10. The sender wakes on `alerts`, on a 5 s poll, or when a send finishes. It works up to 25 users at once.
11. `claimDueDeliveries` picks pending rows with `run_after <= now()`, at most 5 per user and 25 users (the longest-waiting first). Each claimed row becomes `sending`, `locked_at = now()` and `attempts + 1`. A user who already has a delivery in `sending` is skipped, so a user's messages go one at a time.
12. The claim also loads what the message needs: score, reason (the AI reason when the re-score is done, else the rule reason), title, community, URL, post time, posted budget and the chat id.
13. If the channel is off or has no chat id, the rows fail at once with `CHANNEL_DISABLED` and nothing is sent.
14. `telegramAlert` builds the `tg@1` message (see "The message").
15. **Pacing.** One bot-wide limiter (25 sends a second by default, evenly spaced, 40 ms apart) and at least 1.1 s between two messages to one chat. A 429 pauses every taker, including the ones already waiting. The bot's replies use the same limiter.
16. **Shutdown check.** If the sender is stopping, the group is given back (`SHUTDOWN`, attempt not used, retry now).
17. **Fence.** `touchDeliveries` checks that every row is still `sending` with the claim's `attempts`, and refreshes `locked_at`, in one statement. If not (the stale sweep took the rows during a long wait), nothing is sent and the group is given back (`CLAIM_LOST`). This stops a double send after a long 429 pause.
18. `sendMessage` goes out (HTML, link previews off). The inline keyboard is left out if it has no buttons.
19. **Success.** `completeDeliveries` runs one transaction: it deletes the delivery rows (fenced on `sending` and `attempts`) and sets the matches to `sent` with `alerted_at`, `alert_channels`, `alert_template` and `telegram_message_id`. If recording fails, the error is logged; the stale sweep will send the message again.

### 4. Failures

| Telegram answer | Code | What happens |
|---|---|---|
| Network error, timeout, 5xx | `TG_UNAVAILABLE` | Back to `pending` after 30 s doubling (max 30 min); counts an attempt; final `failed` after 5 attempts. Counts toward the breaker. |
| 429 | `RATE_LIMITED` | Back to `pending` after `retry_after` (default 5 s); the attempt is given back; the whole sender pauses |
| 403 | `TG_BLOCKED` | Final. The channel is disabled with reason `blocked`, and the user's other pending rows fail with `CHANNEL_DISABLED` |
| 400 "chat not found" | `TG_CHAT_NOT_FOUND` | Same as 403 |
| Any other 400 | `TG_BAD_REQUEST` | Final for that group; logged at error level (no retry, since the same text would fail again) |
| 401 or 404 | `TG_UNAUTHORIZED` | A bad token is our setting, not the message's fault: retried, attempt not counted. Counts toward the breaker. |

- **Circuit breaker.** After 5 outages in a row (`TG_UNAVAILABLE` or `TG_UNAUTHORIZED`) the sender stops claiming for 60 s. It doubles on each trip, up to 15 min. A success resets it.
- A match becomes `failed` when its last delivery is final (no other one pending or sending).
- **Stale sweep.** Every 60 s, rows `sending` for over 120 s go back to `pending` (the attempt stays counted), or to `failed` (`STALE`) after 5 attempts. The sweep also runs at start.
- **Shutdown.** `stop()` aborts every wait, so groups that were claimed but not sent are given back before it returns. In-flight sends get 3 s inside the worker's shutdown budget.
- Logs carry ids and error codes only. Telegram client errors never carry the URL or the token.

### 5. Linking and /stop (the bot)

20. The web app `POST /api/v1/alerts/telegram/link` revokes the user's older unused tokens, makes a token (32 random bytes, base64url, 43 characters), stores only its SHA-256, and returns `https://t.me/<bot>?start=<token>` and the expiry (15 minutes).
21. The user opens the link and presses Start. The bot, which long-polls `getUpdates` (30 s) while holding the Postgres advisory lock `redlance:telegram-bot`, receives `/start <token>`. A second worker waits and retries every 30 s. Only private chats are handled; groups and channels are ignored.
22. `useTelegramLinkToken` uses the token once (not used, not expired) and, in one transaction, creates or replaces the user's `alert_channels` row (enabled, verified, no disabled reason). If another account had the same chat, that account's channel is disabled with `relinked`, and its pending deliveries fail.
23. The bot replies in plain text: "Connected..." or "This link has expired or was already used...". A bare `/start` explains how to connect.
24. `/stop` disables every account linked to that chat (`user_stop`) and fails their pending deliveries. Any other text gets a one-line help message, at most once an hour per chat.
25. If handling an update throws, the bot logs the codes and replies once "Something went wrong. Please try the link again in a minute." The loop carries on.
26. The poll offset is kept in memory. After a restart Telegram re-sends unconfirmed updates, which is harmless since tokens are single use.

### 6. Web API

All routes are under `/api/v1` and use `apiRoute()`.

| Route | Does |
|---|---|
| `GET /alerts/settings` | `{ minScore, dailyCap, telegram: { linked, enabled, disabledReason } }`. Never the chat id. 403 "Finish onboarding first." without a profile |
| `PATCH /alerts/settings` | `minScore` (integer 0 to 100) and/or `dailyCap` (integer 1 to 100). Strict: unknown fields are rejected. Returns the new settings |
| `POST /alerts/telegram/link` | A new link and expiry. 503 `TELEGRAM_UNAVAILABLE` when the web has no `TELEGRAM_BOT_USERNAME` |
| `DELETE /alerts/telegram` | Revokes unused tokens and disables the channel (`user_stop`). Safe to repeat, or with no channel |

Rate limits: `alerts-settings` is 20 a minute (also used by `DELETE`), `alerts-link` is 5 a minute.

## The message

`tg@1`, HTML parse mode, all post text escaped, link previews off. A leading `[Hiring]` is removed from the title and titles are cut at 120 characters.

```
🎯 84 · Next.js dev to fix Stripe checkout
r/forhire · posted 6 min ago · $400–600
Strong fit: Next.js, Stripe, Postgres; budget above your rate.

[ ✍️ Draft reply ]  [ 🔗 Open post ]
```

- **One match:** the block above with two buttons.
- **2 to 5 matches:** "N new matches", then a block per match (the title links to its draft page), and one "Open Redlance" button to `/feed`.
- **Draft reply** goes to `${APP_ORIGIN}/feed/<matchId>`. **Open post** goes to the post's URL, and only `https://www.reddit.com/...` links are used; anything else is dropped.
- **Localhost or IP origins.** Telegram is believed to reject button URLs on localhost or a raw IP (see the gaps). `appLinksUsable` is false for those origins, so the app buttons and title links are dropped and only "Open post" stays. If no button is left, the keyboard is left out.
- The template version is stored on the match (`alert_template`), so we know which wording a user saw. No opens or clicks are tracked and no message text is stored.

## Upkeep and retention

| Data | Kept |
|---|---|
| `matches` alert columns | Forever |
| `alert_deliveries`, sent | Deleted at once (the facts are on the match) |
| `alert_deliveries`, failed | 30 days (`pruneAlerts`) |
| `telegram_link_tokens` | Deleted 1 day after expiry |

The `prune-alerts` step of the upkeep job calls `pruneAlerts` and logs counts when above 0. It has no test of its own (`pruneAlerts` is tested in `packages/db`).

## Settings

Worker (`apps/worker/.env.local`):

| Variable | Default | Meaning |
|---|---|---|
| `ALERTS_ENABLED` | true | Run the router, and the sender and bot when a token is set |
| `TELEGRAM_BOT_TOKEN` | none | From @BotFather. Shape-checked; the error never contains the value. Unset: no sender and no bot, and routed matches become `skipped_no_channel` |
| `TELEGRAM_BOT_USERNAME` | none | Accepted by the worker, not used by it |
| `TELEGRAM_MAX_PER_SECOND` | 25 | Bot-wide send rate, 1 to 30 |
| `ALERT_MAX_AGE_HOURS` | 24 | A match older than this is not alerted, 1 to 168 |
| `APP_ORIGIN` | none | An http(s) URL, for the links in messages. Required when a token is set. New in the worker |

Web (`apps/web/.env.local`): `TELEGRAM_BOT_USERNAME`. Unset means "Connect Telegram" answers 503.

The worker's DB pool has 5 more connections for alerts. The listeners and the bot's lock use their own connections.

## Commands

- `npm run alerts:status -w @redlance/worker`: counts only. Router backlog, routing outcomes in the last 24 h, deliveries pending, sending and failed, the oldest pending `run_after`, alerts sent in 24 h, linked and disabled Telegram channels. Needs only `DATABASE_URL`.
- `npm run alerts:test -w @redlance/worker -- --user <uuid>`: dev only; it refuses unless `APP_ENV` is `local` or `test`. The user needs a profile. It inserts a fake fresh hiring post (id prefix `t3_alerttest_`, already marked matched so the real matcher ignores it), its analysis, and a match scored 90 through `upsertMatches` with origin `post`. Then it sends `NOTIFY match_alerts` and prints the match id.
- `npm run alerts:test -w @redlance/worker -- --cleanup`: deletes the fake posts (their analyses and matches go with them). Run it after testing. A draft made from a fake post would block the delete.

Do not run `alerts:test` while a soak worker is running against the same database.

## Decisions

- **Telegram only for now; email deferred.** The email design (an email sender on the same queue, SES, batching, one-click unsubscribe) is in git history of `README.md` and section 13 there.
- **Router and sender are separate.** The router is database only and fast; a slow Telegram never holds up matching.
- **Postgres queue, `NOTIFY` bell, polling as the safety net.** No SQS.
- **Decide once.** An outcome never goes back to null. `upsertMatches` never writes the alert columns on update.
- **Backfill never alerts**, and the migration marks every match that exists as `skipped_backfill`.
- **Delete delivery rows on success**, keep failures 30 days.
- **At least once, not exactly once.** A rare duplicate beats a lost alert.
- **A bad token never kills alerts.** A 401 or 404 keeps the message and does not count the attempt.
- **One message per user at a time**, up to 5 matches per message.
- **Long polling, not a webhook**, under an advisory lock: it needs no public URL.
- **Linking is by token, not by chat id.** One chat belongs to one account (`relinked`).
- **No tracking** of opens or clicks.
- Defaults: threshold 70, daily cap 20, freshness 24 h. All easy to change.

## Known gaps and deferred items

- **Not run live.** It needs a dev bot from @BotFather (`TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in the worker env, the username in the web env). The steps are in `plan/07-wiring-ops.md`: link a user, run `alerts:test`, watch `alerts:status` for an hour, `kill -9` mid-send and check the sweep, block the bot and check the channel is disabled. Also check whether 70 is the right default threshold.
- **Unconfirmed:** that Telegram rejects localhost and IP button URLs. It is handled by dropping the app buttons on such origins. If it turns out Telegram accepts them, `appLinksUsable` can be relaxed.
- **L3 (fixed): one bad message used to fail the whole group.** If Telegram answers 400 (`TG_BAD_REQUEST`) for a grouped message of 2 or more matches, the sender now sends each match on its own (same limiter, per-chat spacing, stop signal and claim check), completes the ones that go out and fails only those that get 400 again. Any other error during the split (429, 403, 5xx) fails the not-yet-sent rows by the usual classification; a lone match that gets 400 fails as before.
- **Deploy order.** Stop the old worker before running migration 0015. Otherwise matches the old worker inserts after the migration have a null `alert_outcome` and can alert.
- **No `TELEGRAM_BOT_TOKEN`:** routed matches become `skipped_no_channel` for good. They are not delayed, so adding a token later does not send them.
- **The "Draft reply" link points at `/feed/<matchId>`,** which does not exist until the feed UI is built.
- **The bot username is set twice.** The web's `TELEGRAM_BOT_USERNAME` and the worker's token are configured separately, and must be the same bot. Nothing checks this.
- **Onboarding copy.** The review step (`apps/web/src/components/onboarding/review-step.tsx`) still says "New matches are emailed to {email}". Replacement wording waits for the user's approval.
- **No settings UI.** Only the API. The `relinked` value of `disabledReason` (passed through as a string) needs UI copy.
- **Which plans get Telegram alerts is undecided.** Today every active trial or paid user does (`aiAllowed`).
- **Email is deferred** (README section 13).
- **At-least-once delivery.** A crash between the send and the record, or a failed record, can send a message twice.
- **Backfill against new-post race.** The first insert wins. A brand-new post can lose its alert to a concurrent backfill for the same user and post.
- **Two senders racing on one user** can each claim rows; per-chat spacing keeps the messages apart (noted in the code).
- The bot's poll offset is in memory only.
- No metrics beyond `alerts:status` and logs. `prune-alerts` has no test of its own.
- Two older matching tests in packages/db/src/matches.test.ts ('completePostAnalysis queues a post with live matches even when it no longer qualifies', 'the feed leaves withdrawn matches out') flake about once per full run, likely the host clock vs the Postgres container clock (they compare `new Date()` with database timestamps); they pass on rerun. Not caused by alerts.

## Order of work for the live run

1. Create the dev bot, set the three variables, start the worker.
2. Onboard a dev user, call the link route, open the link, press Start.
3. `alerts:test -- --user <id>`, see the message, then `alerts:test -- --cleanup`.
4. Leave the worker running with real posts, and read `alerts:status`.
5. Record the numbers in `build-notes.md`, then delete `plan/` once the user has read this file.
