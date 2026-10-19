# Phase 7: status reports for matching

Model: **Haiku** · Runs after Phase 5

## Why

When matching runs unattended, we need one command that answers:
- is it keeping up?
- are users hitting their caps?
- what is it costing?

This follows the same style as `npm run ingest:status`.

## Files

### `apps/worker/src/cli/ingest-status.ts`

Add a **Matching** section after the analysis section:
- posts by `match_status` in the last 24 h (pending, running, done, skipped);
- matches created in 24 h, and how many are broad;
- AI in 24 h: done, capped, failed; pending right now;
- re-score spend today (UTC), from `llm_usage` with `task = match_rescore`;
- users who hit their cap today (`rescore_usage` where `used ≥` their plan's cap), as a count;
- duplicates in 24 h (if Phase 1 didn't already add it, add it here).

Put the SQL in a small exported function in `packages/db/src/matches.ts`, `matchingStats(db, now)`, returning plain numbers.

### `apps/worker/src/cli/match-status.ts` (new)

Add `"match:status": "node --env-file-if-exists=.env.local --import tsx src/cli/match-status.ts"` to `apps/worker/package.json`.

Usage: `npm run match:status -w @redlance/worker -- you@example.com`. It prints, for that user:
- plan, trial end, `aiAllowed`;
- today's cap usage (`used / cap`);
- match counts by `ai_status` and by `status`;
- their top 5 matches by score (title cut to 60 characters, score, reason).

It refuses to run unless `APP_ENV` is `local` or `test` (it prints a user's data).

### Pure formatting helpers

Put any formatting (line building) in exported pure functions, e.g. `formatMatchingSection(stats)` and `formatUserMatches(...)`, so they can be tested without a database.

## Test cases

| # | File | Case | Expect |
|---|---|---|---|
| 1 | `packages/db/src/matches.test.ts` | `matchingStats` on seeded data | correct counts for each number |
| 2 | `apps/worker/src/cli/*.test.ts` | `formatMatchingSection` | contains each label and number; spend shown as `$0.0123` |
| 3 | same | `formatUserMatches` with 7 matches | top 5 by score, titles ≤ 60 characters |
| 4 | same | `match:status` guard with `APP_ENV=production` | refuses with a message (test the guard function) |

## Done when

- Both commands print correct numbers on seeded data, and the 4 cases pass.
- The whole repo is green.
- "## Phase 7: done" is in the handoff with a sample output.
