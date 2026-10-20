# Phase 3: Queue and storage SQL

Model: **Opus** (concurrency and fencing) · Runs after Phase 2

## Why

All SQL for alerts lives in one file, tested against the real Postgres, the same way `draft-jobs.ts` holds the draft queue. The worker loops then only call these functions.

## Files

### `packages/db/src/alerts.ts` (new)

Router side:

- `withRoutingBatch(db, limit, decide) → { routed, byOutcome }`: one transaction that
  1. claims matches `where alert_outcome is null order by created_at for update skip locked limit $limit`, joined with what `decideAlert` needs: the post's `posted_at`, the match's `score`, `status`, `withdrawn_at`; the user's `plan`, `trial_ends_at`, `alert_min_score`, `alerts_daily_cap`, `time_zone`; the Telegram channel's `enabled`, `verified_at`;
  2. counts each user's alerts today (`routedTodayCounts`: outcome in `queued`/`sent`/`failed` and `alert_routed_at >= startOfLocalDay`);
  3. calls `decide(items, counts)` (pure; the router passes `decideAlert`);
  4. writes `alert_outcome`, `alert_routed_at = now()`, `alert_score = score` for every item; for `queued`, `insert into alert_deliveries (user_id, match_id, channel) … on conflict (match_id, channel) do nothing`;
  5. `pg_notify('alerts', '')` if any delivery was inserted; commits.

Sender side:

- `claimDueDeliveries(db, channel, { maxUsers, perUser }) → DeliveryGroup[]`: one statement that picks due `pending` rows for the channel (`run_after <= now()`), `for update skip locked`, groups them by user (at most `perUser` rows per user, `maxUsers` users), sets `status = 'sending'`, `locked_at = now()`, `attempts = attempts + 1`, and returns each group with what the message needs: match id, score, rule reason, post title, subreddit, URL, `posted_at`, budget text, the channel `target` (chat id). `attempts` is returned per row to fence the next write.
- `completeDeliveries(db, rows, { channel, providerMessageId, template })`: one transaction:
  - `delete from alert_deliveries where id = $id and status = 'sending' and attempts = $attempts` (fenced; 0 rows → the claim was lost, skip that match's update);
  - `update matches set alert_outcome = 'sent', alerted_at = coalesce(alerted_at, now()), alert_channels = (alert_channels plus the channel, no duplicates), alert_template = $template, telegram_message_id = $messageId`.
- `failDeliveries(db, rows, { code, retryable, countAttempt, retryInMs })`:
  - retryable and `attempts < MAX_DELIVERY_ATTEMPTS` → `status = 'pending'`, `run_after = now() + backoff` (or `retryInMs`), `locked_at = null`; if `!countAttempt`, `attempts = attempts - 1`;
  - else → `status = 'failed'`, `error_code`; and the match's `alert_outcome` → `failed` if it is still `queued` and no other delivery for it is pending or sending.
- `disableChannel(db, userId, kind, reason)`: `enabled = false`, `disabled_reason`; also fails that user's pending rows for the channel (`CHANNEL_DISABLED`), so they don't sit forever.
- `requeueStaleDeliveries(db, olderThanSec = 120) → number`: `sending` rows with old `locked_at` back to `pending` (attempt not refunded).

Linking and upkeep:

- `createTelegramLinkToken(db, userId, tokenHash, ttlMin = 15)`.
- `useTelegramLinkToken(db, tokenHash, chatId) → userId | null`: one transaction: token unused and unexpired → mark used, upsert `alert_channels (user_id, 'telegram', target = chatId, enabled = true, verified_at = now(), disabled_reason = null)`. If another user already had that chat id, the older link is disabled (one chat, one account).
- `disableTelegramByChat(db, chatId, reason)`: for `/stop`.
- `pruneAlerts(db, now)`: delete `failed` deliveries older than 30 days and link tokens expired more than 1 day ago.
- `alertStats(db, since)`: counts per outcome and per status, for `alerts:status`.

### `packages/db/src/index.ts`

Export the module, `ALERTS_CHANNEL = "alerts"` and `MATCH_ALERTS_CHANNEL`.

## Tests (write first, `packages/db/src/alerts.test.ts`, real Postgres)

- routing: each outcome written; deliveries only for `queued`; `alert_routed_at` set; NOTIFY `alerts` only when a delivery was inserted;
- **two routers at once** (two connections, `Promise.all`): every match routed exactly once, no duplicate deliveries;
- daily cap counts queued + sent + failed, not `below_threshold`, and respects the local day;
- claim: only due rows, grouped per user with `perUser` honoured, `attempts` incremented; **25 concurrent claimers never share a row** (same style as the AI-queue test);
- complete: row deleted, match updated, `alert_channels` has no duplicates; a lost claim (attempts changed) updates nothing;
- fail: backoff, `countAttempt: false` keeps the count, final after 5, match → `failed`;
- disable channel fails that user's pending rows only;
- stale sweep; link token: expired, reused, wrong hash, re-linking replaces the target, the same chat linked by a second account disables the first;
- prune keeps recent failures and deletes old ones.

## Done when

`packages/db` tests green; the claim and route SQL each use their partial index (`explain` noted in build notes).
