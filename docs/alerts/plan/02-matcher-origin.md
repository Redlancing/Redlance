# Phase 2: Matcher changes (origin, guard, wake-up)

Model: **Opus** (touches the matcher's fenced upsert) · Runs after Phase 1

## Why

Three small changes make the matcher alert-safe:

1. New users' backfill (last 3 days of posts) must never alert.
2. A re-analysis must never reset a match's alert state (no second alert).
3. The router must wake up when new-post matches land.

## Files

### `packages/db/src/matches.ts` (extend)

- `upsertMatches(db, rows, opts: { origin: "post" | "backfill" })`:
  - on **insert**, `alert_outcome` = `null` for `post`, `'skipped_backfill'` for `backfill`;
  - the `onConflictDoUpdate` `set` list stays as it is: it must **not** mention any `alert_*` column or `telegram_message_id` (add a comment saying so);
  - after the chunks, if `origin === 'post'` and at least one row was **inserted** (not updated), run `select pg_notify('match_alerts', '')` inside the transaction (fires on commit). Use `xmax = 0` in `returning` to tell inserts from updates.
- Export `MATCH_ALERTS_CHANNEL = "match_alerts"`.

A race worth knowing: the backfill and a new post's own matching can insert the same (user, post) pair. Whichever inserts first decides `alert_outcome`; the other becomes an update and leaves it alone. Both outcomes are fine.

### `apps/worker/src/match/matcher.ts` (edit)

- `matchPost` → `upsertMatches(db, rows, { origin: "post" })`.
- `runRematch` → `upsertMatches(db, rows, { origin: "backfill" })`.
- The `MatcherOps` type follows the new signature.

## Tests (write first)

`packages/db/src/matches.test.ts`:
- a `post` insert has `alert_outcome` null; a `backfill` insert has `skipped_backfill`;
- **re-analysis keeps alert state:** set `alert_outcome = 'sent'`, `alerted_at`, `telegram_message_id` on a row, upsert a newer analysis for the same pair, and check all alert columns are unchanged while the score fields changed;
- NOTIFY `match_alerts` fires for a `post` insert, not for an update-only batch and not for `backfill` (listen on a test connection).

`apps/worker/src/match/matcher.test.ts`:
- a new analysed post creates matches with null outcome;
- test 9 (backfill) rows have `skipped_backfill`.

## Done when

All matcher and db tests green, including the existing 290 + 561.
