# Alerts: Telegram

Status: **designed 2026-10-20, not built.** The step-by-step build plan is in [`plan/`](plan/); `conclusion.md` is written after the build. Decisions here were made in the 2026-10-20 design chat.

**Scope: Telegram only.** Email alerts were designed and then deferred (decided 2026-10-20): no email sender, no SES, no unsubscribe flow in this build. The queue keeps a `channel` column so email can be added later as one more sender (§13).

## 1. What we're building

Step 4 of the core loop (Collect → Understand → Match → **Alert** → Draft → Learn). When a new Reddit post matches a user well enough, and the user has connected Telegram, message them within minutes: one message per match, or one message for a few at once.

Every alert has two buttons: **Draft reply** (our app's draft page) and **Open post** (the Reddit post). Rule 1 still holds: an alert only notifies, nothing is ever posted for the user.

Not in this build:

- email alerts (deferred);
- click or open tracking (decided: not measured; `drafts` already records whether an alert led to a draft);
- quiet hours;
- follow-up reminders.

## 2. The big picture

```
 Reddit ─► poller ─► job_posts ─► analyser ─► matcher
                                                │ upsertMatches(origin = 'post')
                                                │   INSERT matches …  ; NOTIFY match_alerts
                                                ▼
                       ┌────────────────── 1. ROUTER (new loop) ──────────────────┐
                       │ claims matches where alert_outcome is null (SKIP LOCKED)  │
                       │ decideAlert(): threshold, fresh?, trial ok?, daily cap,   │
                       │                Telegram linked + enabled?                 │
                       │ one transaction:                                          │
                       │   matches.alert_outcome = 'queued' (or a skip reason)     │
                       │   INSERT alert_deliveries (channel = 'telegram')          │
                       │   NOTIFY alerts                                           │
                       └───────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                           2. TELEGRAM SENDER (new loop)
                           due rows, grouped per user (≤ 5 per message)
                           ≤ 25 msg/s total, ≥ 1.1 s per chat
                           Bot API sendMessage(chat_id)
                                                │
                           on success, one transaction:
                             update matches (alert_outcome = 'sent', alerted_at, …)
                             DELETE the delivery row
                           on final failure: keep the row as 'failed' (30 days)

           3. TELEGRAM BOT (new loop, one per system): long-polls getUpdates for
              "/start <token>" (link an account) and "/stop" (unlink)
```

All three loops run inside the existing worker process (`apps/worker`), next to the matcher and the drafter. No new service, container or AWS queue.

## 3. The components

| # | Component | Where | What it does |
|---|---|---|---|
| 0 | **Matcher change** | `apps/worker/src/match/matcher.ts`, `packages/db/src/matches.ts` | Tells new-post matches apart from onboarding-backfill matches; wakes the router |
| 1 | **Router** | `apps/worker/src/alerts/router.ts` | Decides, per new match, whether to alert. Database work only, no network |
| 2 | **Telegram sender** | `apps/worker/src/alerts/telegram/sender.ts` | Sends due deliveries within Telegram's limits |
| 3 | **Telegram bot** | `apps/worker/src/alerts/telegram/bot.ts` | Links and unlinks Telegram accounts (`/start <token>`, `/stop`) |
| 4 | **Pure rules** | `packages/core/src/alerts/` | `decideAlert`, message formatting, links, backoff. No I/O, fully unit-tested |
| 5 | **Queue + storage** | `packages/db/src/alerts.ts`, migration `0015_alerts.sql` | Claims, completes, fails and sweeps rows; all SQL lives here |
| 6 | **Web API** | `apps/web/src/app/api/v1/alerts/…` | Settings, Telegram link and unlink |

Why the router is separate from the sender: the router makes decisions (fast, database only), the sender does the slow network work and paces itself to Telegram's limits. A slow Telegram never holds up matching. It also leaves room for an email sender later without touching the router's decisions.

### Who gets messages

A Telegram bot **cannot message anyone who hasn't opened it and pressed Start** (Telegram's rule). Pressing Start through our link is what gives us the user's `chat_id`. So:

- one bot serves every user; each user has their own private chat with it;
- only users who linked Telegram (`alert_channels` row with `kind = 'telegram'`, `verified_at` set, `enabled = true`) get alerts;
- everyone else's matches are recorded as `skipped_no_channel` and still appear in the feed.

## 4. The flow, step by step

### 4.1 A new post arrives

1. The analyser finishes a post; the matcher scores it against every candidate user (`matchPost`).
2. `upsertMatches(rows, { origin: 'post' })` inserts the new `matches` rows and, in the same transaction, runs `NOTIFY match_alerts`.

### 4.2 The router decides

3. The router wakes (NOTIFY, or its 15 s poll as a safety net) and claims up to 200 matches with `alert_outcome is null` (`FOR UPDATE SKIP LOCKED`, so a second worker could never take the same rows).
4. For each match it loads the user's settings and Telegram channel and calls the pure `decideAlert()`:

| Check (in order) | Outcome written on the match |
|---|---|
| Match withdrawn or dismissed | `skipped_withdrawn` |
| `score < profiles.alert_min_score` (default 70) | `below_threshold` |
| Post older than `ALERT_MAX_AGE_HOURS` (default 24) | `skipped_stale` |
| Trial ended and no paid plan | `skipped_trial` |
| User already had `alerts_daily_cap` (default 20) alerts today (their time zone) | `skipped_cap` |
| Telegram not linked, not verified or disabled (or no bot token configured) | `skipped_no_channel` |
| Otherwise | `queued`, plus one `alert_deliveries` row |

5. One transaction: write the outcome, `alert_routed_at` and `alert_score`, insert the delivery row, `NOTIFY alerts`.

Every examined match gets an outcome, so the router's "waiting" set (and its index) stays tiny.

### 4.3 Telegram sends

6. The sender claims due rows (`status = 'pending'`, `run_after <= now()`), grouped by user, up to 5 per user.
7. It builds one message (one match → a single alert; 2 to 5 → "3 new matches" with a line each) and calls `sendMessage` with URL buttons and link previews off.
8. Pacing: a token bucket of 25 messages a second for the whole bot, and at least 1.1 s between messages to the same chat. A 429 answer pauses all sending for its `retry_after` seconds.
9. Success → one transaction per row: update the match (`alert_outcome = 'sent'`, `alerted_at`, `alert_channels = {telegram}`, `telegram_message_id`, `alert_template`) and **delete** the delivery row.

### 4.4 Failures

| Error | What happens |
|---|---|
| Network error, 5xx, timeout | Back to `pending`, `run_after = now + 30 s × 2^(attempts − 1)`; final after 5 attempts |
| 429 Too Many Requests | Back to `pending` after `retry_after`; does **not** count as an attempt; the whole sender pauses |
| 403 (user blocked the bot) or 400 "chat not found" | Final at once; the channel is disabled (`enabled = false`, `disabled_reason = 'blocked'`) and the user's other pending rows are failed |
| Worker crash while `sending` | The stale sweep (every 60 s) puts rows locked for more than 2 min back to `pending` |

A final failure keeps the row (`status = 'failed'`, `error_code`) for debugging and sets `matches.alert_outcome = 'failed'`. Failed rows are deleted after 30 days by the upkeep job.

### 4.5 Linking Telegram

```
web: "Connect Telegram" ─► POST /api/v1/alerts/telegram/link
        creates a one-time token (32 random bytes; only its SHA-256 is stored; 15 min)
        returns https://t.me/<bot username>?start=<token>
user taps the link ─► Telegram opens the bot ─► user presses Start
bot loop (getUpdates) receives "/start <token>"
        token valid and unused ─► upsert alert_channels (telegram, chat_id, verified_at = now)
                               ─► mark token used ─► reply "Connected. You'll get matches here."
        invalid or expired     ─► reply "This link has expired. Open Redlance and try again."
"/stop" in the chat ─► disable the channel ─► reply "Alerts are off."
```

Why long polling (`getUpdates`) and not a webhook: it needs no public URL, so it works the same on the laptop and on EC2. Only one process may call `getUpdates` per bot, so the bot loop takes a Postgres advisory lock (`redlance:telegram-bot`), exactly like the Reddit poller.

### 4.6 Creating the bot (one time, by hand)

1. In Telegram, open **@BotFather** → `/newbot` → a name ("Redlance") and a username ending in `bot`.
2. BotFather returns a **token** (the bot's password). It goes in `apps/worker/.env.local` locally and in the server's secrets in production; never in code or logs.
3. Optional: `/setuserpic` (logo), `/setdescription`, `/setcommands` (`start`, `stop`).
4. Two bots: **"Redlance (dev)"** for the laptop and **"Redlance"** for production, with separate tokens, so tests never message real users.

Our code talks to it over plain HTTPS (`https://api.telegram.org/bot<token>/<method>`) with two methods, `sendMessage` and `getUpdates`, so no Telegram library is needed.

## 5. The rules that prevent double or unwanted alerts

1. **One match row per user + post** (`matches_user_post_unique`). A re-analysis updates the same row.
2. **The router only takes `alert_outcome is null`**, and an outcome never goes back to null. `upsertMatches` must never reset the alert columns (a test checks it).
3. **Backfill never alerts.** Onboarding matches a new user against the last 3 days; those rows are inserted with `alert_outcome = 'skipped_backfill'`. A profile edit does not re-match at all (decided 2026-10-20).
4. **Existing matches never alert:** the migration marks every match that exists when it runs as `skipped_backfill`.
5. **Freshness:** only posts newer than `ALERT_MAX_AGE_HOURS` (24) alert. This also covers an analysis backlog (the AI budget paused overnight).
6. **Unique `(match_id, channel)`** on `alert_deliveries` while the row exists.
7. **At least once, not exactly once.** Telegram and Postgres are two systems with no shared transaction. We record "sent" *after* Telegram accepts, so a crash in that ~100 ms gap can send one alert twice. A rare duplicate beats a lost alert.

## 6. Tables

### `profiles` (new columns)

| Column | Default | Meaning |
|---|---|---|
| `alert_min_score` | 70 | Alert at this score or above (0–100) |
| `alerts_daily_cap` | 20 | Most alerts per day (user's time zone) |

### `alert_channels` (exists; one new column)

| Column | Meaning |
|---|---|
| `kind`, `target`, `enabled`, `verified_at` | Exist. For Telegram, `target` is the chat id. (The `email` row onboarding creates is left as it is and not used yet.) |
| `disabled_reason` (new) | `blocked` or `user_stop` |

### `matches` (new columns, kept forever)

| Column | Example | Meaning |
|---|---|---|
| `alert_outcome` | `sent` | `queued`, `sent`, `failed`, `below_threshold`, `skipped_backfill`, `skipped_stale`, `skipped_trial`, `skipped_cap`, `skipped_no_channel`, `skipped_withdrawn` |
| `alert_routed_at` | 14:03:11 | When the router decided (any outcome); the daily cap counts these |
| `alerted_at` | 14:03:12 | When the alert was delivered |
| `alert_channels` | `{telegram}` | Channels that delivered (ready for email later) |
| `alert_score` | 84 | The score shown in the alert |
| `alert_template` | `tg@1` | Template version, so the text can be rebuilt (the text itself is not stored) |
| `telegram_message_id` | 40211 | Lets the bot edit the message later |

Indexes: `matches_alert_route_idx` on `(created_at) where alert_outcome is null` (the router's claim) and `matches_user_routed_idx` on `(user_id, alert_routed_at) where alert_outcome in ('queued', 'sent', 'failed')` (the daily cap counts queued alerts too, so a burst can't overshoot it).

### `alert_deliveries` (new; the queue)

`id`, `user_id`, `match_id`, `channel` (only `telegram` for now), `status` (`pending` → `sending` → deleted, or `failed`), `attempts`, `run_after`, `locked_at`, `error_code`, `provider_message_id`, `created_at`. Unique `(match_id, channel)`; partial index on `(channel, run_after) where status = 'pending'`. Successful rows are deleted; failed rows are kept 30 days.

### `telegram_link_tokens` (new)

`token_hash` (primary key), `user_id`, `expires_at`, `used_at`, `created_at`. Deleted by upkeep 1 day after expiry.

## 7. The message

`parse_mode: HTML`, all post text escaped, link previews off:

```
🎯 84 · Next.js dev to fix Stripe checkout
r/forhire · posted 6 min ago · $400–600
Strong fit: Next.js, Stripe, Postgres; budget above your rate.

[ ✍️ Draft reply ]  [ 🔗 Open post ]
```

Links: **Draft reply** → `${APP_ORIGIN}/feed/<matchId>` (the page is built with the feed UI); **Open post** → the post's Reddit URL from `job_posts.url` (only `https://www.reddit.com/…` URLs are used). No redirects, no tracking.

## 8. Settings and API (all under `/api/v1`, all through `apiRoute()`)

| Route | Does |
|---|---|
| `GET /alerts/settings` | Threshold, daily cap, and the Telegram channel's state (linked, enabled, why disabled). Never the chat id |
| `PATCH /alerts/settings` | Change threshold (0–100) and daily cap (1–100) |
| `POST /alerts/telegram/link` | New one-time link token; returns the `t.me` deep link |
| `DELETE /alerts/telegram` | Disable the Telegram channel |

## 9. Settings (env)

Worker:

| Variable | Default | Meaning |
|---|---|---|
| `ALERTS_ENABLED` | true | Run the router, sender and bot |
| `TELEGRAM_BOT_TOKEN` | — | From @BotFather. Unset → sender and bot off, and the router records `skipped_no_channel` |
| `TELEGRAM_BOT_USERNAME` | — | For deep links (`t.me/<name>`) |
| `TELEGRAM_MAX_PER_SECOND` | 25 | Global send rate (Telegram allows about 30) |
| `ALERT_MAX_AGE_HOURS` | 24 | Freshness rule |
| `APP_ORIGIN` | — | For the Draft reply link |

Web: `TELEGRAM_BOT_USERNAME`.

## 10. Throughput

**What we need.** About 400 hiring posts a day. Guessing ~3% of users clear the threshold per post (the soak run will give the real number), and counting only users with Telegram linked:

| Linked users | Alerts a day | Average | Peak (~10×) | Per 5-minute poll cycle |
|---|---|---|---|---|
| 1,000 | ~12,000 | 0.14/s | ~1.5/s | ~40 |
| 10,000 | ~120,000 | 1.4/s | ~15/s | ~420 |
| 100,000 | ~1.2 million | 14/s | ~140/s | ~4,200 |

**What each part can do.**

| Part | Limit | Comes into play |
|---|---|---|
| Postgres queue (SKIP LOCKED, small server) | thousands of claims a second | not a concern |
| Router | hundreds of matches a second (database only) | not a concern |
| Telegram Bot API | ~30 messages/s per bot, 1/s per chat (Bot FAQ, checked 2026-10-20; paid broadcasts need 100k monthly users) | peaks at ~20,000+ users; coalescing several matches per message pushes it further |

Telegram's ~30/s is 9,000 messages per 5 minutes, more than the ~4,200 alerts per cycle at 100,000 users, so the queue drains between poll cycles.

**Latency** from posting on Reddit to the Telegram ping: poll wait (≤ 5 min) + analysis (~1.5 s) + matching (< 1 s) + router (< 1 s) + send (~0.3 s) ≈ **2–5 minutes**, almost all of it the poll interval.

**Postgres load.** Measured on 2026-10-20 with all five current loops: 10 connections of 100, 3.7 transactions a second. The alert loops add about 3 connections and, at 1,000 users, well under 1 write a second.

## 11. Storage and retention

| Data | Kept |
|---|---|
| `matches` alert columns | Forever (~40 bytes per alerted match) |
| `alert_deliveries`, sent | Deleted immediately (the facts are on the match) |
| `alert_deliveries`, failed | 30 days |
| `telegram_link_tokens` | Deleted 1 day after expiry |
| Message text, opens, clicks | Never stored |

## 12. Security and privacy

- Post titles and bodies are untrusted: HTML-escaped (`parse_mode: HTML`).
- Logs carry ids and error codes only, never post text or chat ids (same rule as the matcher).
- The bot token lives in env, never in code or logs; error logs show the Telegram method and status only.
- Link tokens: 32 random bytes, only the hash is stored, single use, 15 minutes.
- Group chats are ignored: alerts go to private chats only.

## 13. Decisions and open questions

Decided (2026-10-20):

- Postgres tables as the queues, LISTEN/NOTIFY as the wake-up bell, polling as the safety net (no SQS).
- A router plus a Telegram sender, all in the worker.
- **Telegram only for now; email deferred.** When it comes back, the design from the 2026-10-20 chat applies: an email sender on the same queue (`channel = 'email'`), AWS SES behind an `EmailTransport` interface (a `log` transport locally), batched at most every 30 minutes, one-click unsubscribe with an HMAC token, an `EMAIL_ALLOWLIST` outside production, and SES domain verification (DKIM, MAIL FROM, DMARC) once the Route 53 hosted zone exists. Git history has the full email design (`docs/alerts/README.md`, 2026-10-20).
- No click or open tracking.
- Delete delivery rows on success; keep failures 30 days.
- Backfill never alerts; profile edits don't re-match.
- Telegram linking by long polling under an advisory lock.

Defaults chosen in the plan, easy to change later: threshold **70**, daily cap **20**, freshness **24 h**.

Open:

- Which plans get Telegram alerts (the old spec made instant alerts a paid feature). For now every active trial or paid user.
- Onboarding's review step says "New matches are emailed to {email}". The plan changes it to point at connecting Telegram (Phase 6); the exact wording is yours to approve.

## 14. Build phases

| Phase | File | What |
|---|---|---|
| 1 | [`plan/01-schema-core.md`](plan/01-schema-core.md) | Migration, Drizzle schema, pure rules in core |
| 2 | [`plan/02-matcher-origin.md`](plan/02-matcher-origin.md) | Backfill vs new-post matches, never reset alert columns, wake the router |
| 3 | [`plan/03-queue-db.md`](plan/03-queue-db.md) | All alert SQL in `packages/db/src/alerts.ts` |
| 4 | [`plan/04-router.md`](plan/04-router.md) | The router loop |
| 5 | [`plan/05-telegram.md`](plan/05-telegram.md) | Bot API client, sender, linking bot |
| 6 | [`plan/06-api.md`](plan/06-api.md) | Settings, Telegram link and unlink, onboarding copy |
| 7 | [`plan/07-wiring-ops.md`](plan/07-wiring-ops.md) | Worker wiring, env, upkeep, `alerts:status`, live check |
| 8 | [`plan/08-review-finish.md`](plan/08-review-finish.md) | Whole-branch review, fixes, `conclusion.md` |

How to work: branch `feat/alerts` from `main`; test first in every phase; `npm test`, typecheck and lint green at the end of each phase; notes in `plan/build-notes.md` as you go.
