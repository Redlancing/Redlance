# Phase 4: The router loop

Model: **Sonnet** (follows the matcher's loop shape) · Runs after Phase 3

## Why

The router turns new matches into alert decisions. It is the only place that reads the user's alert settings, so the sender never has to.

## Files

### `apps/worker/src/alerts/router.ts` (new)

`createRouter(deps) → { start, stop, idle }`, the same structure as `apps/worker/src/match/matcher.ts`:

- deps: `db`, `log`, `listen` (LISTEN `match_alerts` on its own connection via `createPgListener`), `maxAgeHours`, `telegramAvailable` (false when no bot token), `pollMs` (15 s), `now`;
- `pump()`: loop `withRoutingBatch(db, 200, decide)` until a batch returns fewer than 200; only one pump at a time (a wake-up while running sets a "run again" flag);
- `decide(items, counts)`: `decideAlert` per item; a user with several matches in one batch counts the ones already queued in this batch toward the cap;
- logs one line per batch with counts per outcome; never post text;
- errors: a failed batch rolls back (nothing half-written), is logged with `errorFields` (no messages), and the next poll retries.

## Tests (write first, `apps/worker/src/alerts/router.test.ts`)

Real Postgres, seeded with the matcher-test helpers:

- a new-post match at score 80 with Telegram linked → `queued`, one delivery, NOTIFY `alerts`;
- each skip outcome end to end (threshold, stale, trial, cap, no channel, withdrawn);
- six matches for one user in one batch with cap 5 → five `queued`, one `skipped_cap`;
- backfill rows are never picked up (already `skipped_backfill`);
- no bot token → `skipped_no_channel` even with a linked channel;
- wakes on NOTIFY within ~100 ms; the poll alone also routes (listener stubbed out);
- stop() during a batch finishes or rolls back cleanly.

## Done when

Worker tests green; routing 1,000 seeded matches takes well under a second (note the time in build notes).
