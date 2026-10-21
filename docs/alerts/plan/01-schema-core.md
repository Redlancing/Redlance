# Phase 1: Schema and pure rules

Model: **Opus** (schema is hard to change later) · Runs first

## Why

Everything else builds on the tables and on one pure function, `decideAlert`, that holds every alert rule. Keeping the rules pure (no database, no clock, no network) means each rule gets a plain unit test.

## Files

### `packages/db/migrations/0015_alerts.sql` (generated)

Change `packages/db/src/schema.ts`, then `npm run db:generate` and commit the SQL. Never hand-edit an applied migration.

- `profiles`: add
  - `alert_min_score integer not null default 70` (check 0–100);
  - `alerts_daily_cap integer not null default 20` (check 1–100).
- `alert_channels`: add `disabled_reason text` (check in `blocked`, `user_stop`).
- `matches`: add `alert_outcome text` (check in the `ALERT_OUTCOMES` list), `alert_routed_at timestamptz`, `alerted_at timestamptz`, `alert_channels text[] not null default '{}'`, `alert_score integer`, `alert_template text`, `telegram_message_id bigint`.
  - index `matches_alert_route_idx` on `(created_at)` where `alert_outcome is null`;
  - index `matches_user_routed_idx` on `(user_id, alert_routed_at)` where `alert_outcome in ('queued','sent','failed')`.
  - **Existing rows:** the migration sets `alert_outcome = 'skipped_backfill'` on every match that exists when it runs, so turning alerts on never pings users about old matches. (Drizzle generates the DDL; add this `update` to the generated file before it is ever applied, and note it in build notes.)
- `alert_deliveries` (new): `id` (v7), `user_id` (fk users, cascade), `match_id` (fk matches, cascade), `channel` (check in `DELIVERY_CHANNELS` = `telegram` only for now), `status` (check `pending`/`sending`/`failed`), `attempts int not null default 0`, `run_after timestamptz not null default now()`, `locked_at`, `error_code text`, `provider_message_id text`, `created_at`.
  - unique `(match_id, channel)`;
  - index `alert_deliveries_due_idx` on `(channel, run_after)` where `status = 'pending'`;
  - index `alert_deliveries_sending_idx` on `(locked_at)` where `status = 'sending'`.
- `telegram_link_tokens` (new): `token_hash text primary key`, `user_id` (fk, cascade), `expires_at`, `used_at`, `created_at`.

### `packages/db/src/schema.ts` (extend)

The Drizzle definitions for the above, with the constant lists exported (`ALERT_OUTCOMES`, `DELIVERY_CHANNELS`, `DELIVERY_STATUSES`, `CHANNEL_DISABLED_REASONS`), following how `AI_STATUSES` and `ALERT_KINDS` are done.

### `packages/core/src/alerts/constants.ts` (new)

```ts
export const ALERT_OUTCOMES = ["queued", "sent", "failed", "below_threshold", "skipped_backfill",
  "skipped_stale", "skipped_trial", "skipped_cap", "skipped_no_channel", "skipped_withdrawn"] as const;
export const DELIVERY_CHANNELS = ["telegram"] as const;   // "email" later
export const ALERT_MIN_SCORE_DEFAULT = 70;
export const ALERTS_DAILY_CAP_DEFAULT = 20;
export const ALERT_MAX_AGE_HOURS_DEFAULT = 24;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const TELEGRAM_MATCHES_PER_MESSAGE = 5;
export const TEMPLATE_VERSIONS = { telegram: "tg@1" } as const;
```

### `packages/core/src/alerts/decide.ts` (new)

`decideAlert(input, now) → { outcome, channels: "telegram"[] }`, where `input` has the match (`score`, `postedAt`, `withdrawn`, `status`), the user (`plan`, `trialEndsAt`, `alertMinScore`, `dailyCap`, `routedToday`), the Telegram channel (`{ enabled, verified } | null`), `telegramAvailable` (a bot token is configured) and `maxAgeHours`.

Order of checks (first hit wins): withdrawn or dismissed → `skipped_withdrawn`; below threshold → `below_threshold`; too old → `skipped_stale`; `!aiAllowed(plan, trialEndsAt, now)` (reuse `matching/plans.ts`) → `skipped_trial`; `routedToday >= dailyCap` → `skipped_cap`; Telegram missing, unverified, disabled or unavailable → `skipped_no_channel`; else `queued` with `["telegram"]`.

### `packages/core/src/alerts/schedule.ts` (new)

- `startOfLocalDay(timeZone, now) → Date` for the daily cap (DST-safe via `Intl.DateTimeFormat`).
- `deliveryBackoffMs(attempts) → 30 s × 2^(attempts − 1)`, capped at 30 min.

### `packages/core/src/alerts/format.ts` (new)

Pure message builders; all post text HTML-escaped.

- `telegramAlert(items, appOrigin) → { text, replyMarkup }`: one item → single alert (score, title, subreddit, age, budget, reason, two URL buttons); 2–5 → a list with one "Draft" link per line and an "Open Redlance" button.
- `alertLinks(appOrigin, matchId, postUrl)` → `{ draft: `${appOrigin}/feed/${matchId}`, post }`. Only `https://www.reddit.com/…` post URLs are accepted (anything else drops the Open post button).

### `packages/core/src/index.ts`

Export the new module.

## Tests (write first)

- `decide.test.ts`: one case per outcome, the check order (a stale and below-threshold match is `below_threshold`), no bot token → `skipped_no_channel`, expired trial vs paid plan.
- `schedule.test.ts`: start of local day in UTC, Asia/Kolkata and America/New_York, including a DST change day; backoff values and cap.
- `format.test.ts`: escaping `<script>` and `&` in titles, 1 vs 3 items, missing budget, a non-Reddit URL drops the button, a snapshot of the exact `tg@1` text.
- `packages/db`: the migration's update marks existing matches `skipped_backfill`; check constraints reject bad values.

## Done when

Migration applies on a fresh and on the current dev database; core and db tests green; typecheck clean.
