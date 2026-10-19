# Phase 5: Credits, caps, budget and the hourly warning

Model: **Opus** (money and concurrency) · Runs after Phase 4

## Why

Credits are money. Two clicks at the same moment must never spend the same credits twice, and a failed draft must give the credits back exactly once. The daily caps and the system budget are what stop a bug from running up the AI bill. All of this lives in Postgres transactions, except the hourly warning, which is a soft Redis counter.

## Files

### `packages/db/src/credits.ts` (new)

All functions take an `Executor`, so they can run inside the caller's transaction.

- `grantCredits(db, { userId, plan, amount, periodStart, periodEnd })`:
  - upsert `credit_balances`, **replacing** the balance (no rollover);
  - write an `expire` ledger row for any leftover balance, then a `grant` row.
- `grantPlanCredits(db, userId, plan, periodEnd, now)` uses `PLAN_CREDITS[plan]`.
- `reserveCredits(db, { userId, amount, draftId }) → { ok: true, balance } | { ok: false, reason: "insufficient" }`:
  - `update credit_balances set balance = balance - $amount where user_id = $1 and balance >= $amount and period_end > now() returning balance`, plus a `reserve` ledger row with `delta = -amount`;
  - no row updated → insufficient.
- `refundCredits(db, { userId, draftId })`:
  - adds back the draft's reserved amount;
  - **idempotent**: does nothing if a `refund` row for that draft already exists. Use a partial unique index on `credit_ledger (draft_id) where reason = 'refund'`, added by this phase's migration `0013_credit_refund_once.sql`.
- `creditsUsedToday(db, userId, now) → number`: −sum(reserve) − sum(refund) for the UTC day.
- `costTodayMicros(db, userId, now) → number`: sum of `llm_usage.cost_micros` for the user, tasks `draft`, `rewrite` and `voice`, for the UTC day.
- `systemDraftCostTodayMicros(db, now)`: the same for all users.
- `getCredits(db, userId) → { plan, balance, periodEnd } | null`.

### `packages/db/src/drafts.ts` (extend)

`createDraftJob(db, { userId, matchId, jobPostId, version, parentId?, kind, option?, instruction?, credits, idempotencyKey, evidence? }) → { draft } | { error }`. **One transaction:**
1. If the idempotency key already exists for the user, return that draft (no second charge).
2. Check today's credits used + `credits` ≤ `DAILY_CREDIT_CAP[plan]` → else `daily_limit`.
3. Check `costTodayMicros < DAILY_COST_CAP_MICROS[plan]` → else `daily_limit`.
4. `reserveCredits` → else `insufficient`.
5. Insert the draft (status pending). A unique (user, match, version) conflict → return the existing draft and roll back the reserve.
6. `pg_notify('drafts', id)`.

To serialise two requests from the same user, lock the user's `credit_balances` row first (`select … for update`). The cap checks and the reserve then can't interleave.

### `apps/web/src/server/rate-limit/index.ts`

- Add `countInWindow(subject, name, windowSec) → { count } | null`: an `INCR` + `EXPIRE` keyed by window start. It **fails open**, returning null on Redis errors and logging.
- The hourly warning uses `countInWindow("u:<id>", "drafts", 3600)`; `slowDown = count > HOURLY_WARNING`.

### Env (web + worker)

- `DRAFT_BUDGET_ALERT_USD` (default 40) and `DRAFT_BUDGET_PAUSE_USD` (default 80): numbers, 0–10,000.
- `isDraftingPaused(db, env, now)`: true when `systemDraftCostTodayMicros` ≥ pause.
- `shouldAlert`: ≥ alert, logged once per day (a "warn once a day" helper, as in the analyser).

### Dev script

`apps/worker/scripts/grant-credits.ts`, run as `npm run credits:grant -w @redlance/worker -- --email x --plan standard [--days 30]`.

## Test cases

`packages/db/src/credits.test.ts` (test database):

| # | Case | Expect |
|---|---|---|
| 1 | Grant 210 to a trial user | balance 210; one `grant` row |
| 2 | Grant again with 50 left | an `expire` row of −50, a `grant` of 2,100, balance 2,100 |
| 3 | Reserve 7 from 210 | 203; a `reserve` row of −7 |
| 4 | Reserve 7 with balance 6 | insufficient; balance stays 6; no ledger row |
| 5 | Reserve after `period_end` | insufficient |
| 6 | Refund a draft | balance back; a `refund` row |
| 7 | Refund the same draft twice | the second does nothing (balance unchanged) |
| 8 | **Two concurrent reserves** of 7 with balance 10 (two connections) | exactly one succeeds; balance 3 |
| 9 | `creditsUsedToday` with reserves of 7 and 1 and a refund of 7 | 1 |
| 10 | Ledger rows from yesterday (fake `now`) | not counted today |
| 11 | `costTodayMicros` with `llm_usage` rows for draft, rewrite, voice and post_analysis | only the first three summed |

`packages/db/src/drafts.test.ts` (extend):

| # | Case | Expect |
|---|---|---|
| 12 | `createDraftJob` happy path | pending draft, reserve row, NOTIFY sent (listen on a test client) |
| 13 | Same idempotency key twice | one draft, one reserve |
| 14 | Same (user, match, version) with a new key | the existing draft returned, no extra reserve |
| 15 | Daily credit cap reached (trial: 105 used today) | `daily_limit`; no reserve |
| 16 | Cost today at the cap | `daily_limit` |
| 17 | **Concurrent `createDraftJob` for 20 different matches**, trial user with 105 credits left today and enough balance | at most 15 drafts (105 ÷ 7); the cap is never exceeded |
| 18 | Insufficient balance | `insufficient`; no draft row |

`apps/web` rate-limit test:

| # | Case | Expect |
|---|---|---|
| 19 | 11 calls in one hour | the 11th returns `count` 11 → `slowDown` |
| 20 | Redis down | returns null; the caller treats it as no warning |
| 21 | Budget: `llm_usage` today ≥ pause | `isDraftingPaused` true; below → false |

## Done when

- All 21 cases pass, including the two concurrency tests, run 5 times in a row without flaking.
- The whole repo is green.
- "## Phase 5: done" in `plan/build-notes.md`: the locking order (balance row first), the refund-once index, and the env names.
