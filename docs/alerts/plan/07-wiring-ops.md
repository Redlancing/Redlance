# Phase 7: Wiring, env, upkeep and a live run

Model: **Sonnet** (wiring) · Runs after Phases 4–6

## Why

Turn the parts on inside the worker, make them observable, and prove the whole chain (Reddit post → match → Telegram) works with real data.

## Files

### `apps/worker/src/env.ts` (extend) and `apps/worker/.env.example`

Add the variables from README §9 with zod validation: `ALERTS_ENABLED` (default true), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MAX_PER_SECOND` (1–30, default 25), `ALERT_MAX_AGE_HOURS` (1–168, default 24), `APP_ORIGIN` (for links; required when a bot token is set). Tests in `env.test.ts`.

### `apps/worker/src/alerts/index.ts` (new)

`createAlertsFromEnv(env, { db, log }) → { start, stop } | null`: builds the router, and the Telegram sender and bot only when a token is set. Logs one line at start: which parts run and why the others don't (e.g. "no TELEGRAM_BOT_TOKEN: router records skipped_no_channel").

### `apps/worker/src/index.ts` (edit)

Start after the matcher, stop with the others, add `alerts: …` to the "worker started" line. Raise the pool `max` by 2 (router batch, sender); the listeners and the bot's advisory lock use their own connections.

### `apps/worker/src/ingest/upkeep.ts` (edit)

Call `pruneAlerts(db, now)` in the existing upkeep run.

### `apps/worker/src/cli/alerts-status.ts` (new) + `alerts:status` script

Prints: router backlog (`alert_outcome is null`), outcomes in the last 24 h, deliveries pending/sending/failed, the oldest pending `run_after`, alerts sent in 24 h, linked and disabled Telegram channels. Same style as `ingest:status`.

### `apps/worker/scripts/alert-test.ts` (new) + `alerts:test` script

Dev only (`APP_ENV=local`): for a given user, insert one fake fresh match above their threshold, to see the whole path without waiting for Reddit.

### Docs

- `docs/README.md`: Alerts row → "Built"; add the alert loops to the system diagram.
- `CLAUDE.md` handover: what's built, how to run it.

## Live run (needs you for step 1)

1. Create the dev bot with @BotFather (README §4.6) and put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in `apps/worker/.env.local` and the username in `apps/web/.env.local`.
2. With the soak data in the dev db and a dev user onboarded, call `POST /api/v1/alerts/telegram/link`, open the link, press Start.
3. `npm run alerts:test -w @redlance/worker -- --user <id>` → the message arrives.
4. Leave the worker running for an hour with real posts; check `alerts:status`: no backlog, no stuck `sending`, outcomes look sensible (how many `below_threshold` at 70: is the default right?).
5. Kill the worker mid-send (`kill -9`), restart, confirm the stale sweep recovers. Block the bot in Telegram and confirm the channel is disabled.

## Done when

All tests, typecheck, lint and build green; the live run's numbers noted in `build-notes.md`.
