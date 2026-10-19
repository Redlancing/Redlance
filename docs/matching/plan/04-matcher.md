# Phase 4: the matcher (worker)

Model: **Opus** · Runs after Phase 3

## Why

This is the loop that turns analysed posts into `matches` rows. It runs in the worker next to the poller and analyser, using the same pattern:
- `LISTEN` for a signal;
- poll as a backup;
- claim with `SKIP LOCKED`;
- fenced writes;
- a stale sweep;
- a graceful stop.

It also serves backfill (new users) and re-match requests (profile changes).

## Files

### `apps/worker/src/match/matcher.ts` (new)

`createMatcher(deps) → { start(): Promise<void>; stop(graceMs?): Promise<void>; idle(): Promise<void> }`

`deps`:
- `db`, `log`;
- `listen` (a `createPgListener` on `post_analysed` **and** `matches`, or two listeners; re-match requests have no channel, so the poll picks them up);
- `now`;
- settings: `threshold`, `maxAgeDays`, `concurrency`, `pollMs` (10 s), `sweepMs` (60 s).

**One post** (`matchPost(postId, claim)`):
1. `loadMatchPost`. If core `passesFilters` fails at the post level (age, deadline, kind, full-time), call `completePostMatching` and stop.
2. `candidateUsersForPost(post)`.
3. For each candidate: core `isCandidate` and `passesFilters` (a double check; skip any disagreement and **log it as an error**, since it means the SQL and core have drifted), then `ruleScore`.
4. Work out `ai_status`:
   - the user is already dismissed → `not_needed`;
   - `!aiAllowed(plan, trialEndsAt, now)` → `not_needed`;
   - broad → `not_needed` (broad matches are never AI re-scored);
   - `score ≥ threshold` → `pending`;
   - else → `not_needed`.
5. `upsertMatches` with the rows from step 3, using each user's current `profile_version`. Then `completePostMatching`.
6. Any throw → `failPostMatching`. Log the error code and post id only, never post text.

**One re-match** (`runRematch({ userId, since })`):
1. Load that user's profile and plan; `candidatePostsForUser(userId, since)`.
2. For each post: the same scoring and `ai_status` rules, then `upsertMatches`.
3. On failure, call `requestRematch(userId, since)` again and log.

**The loop:**
- On `post_analysed`, the poll, or start: claim up to `concurrency` posts and process them in parallel.
- Each poll also does `claimRematch` (one at a time) and the stale sweep (`requeueStalePostMatching`).
- `stop`: stop timers, abort, wait for in-flight work within `graceMs`, close listeners.

### `apps/worker/src/env.ts`
- `MATCHING_ENABLED` ("true" / "false", default true);
- `RESCORE_THRESHOLD` (int 0–100, default 50);
- `MATCH_MAX_AGE_DAYS` (int 1–30, default 7).
- Add them to `.env.example`.

### `apps/worker/src/index.ts`
- When `MATCHING_ENABLED`, create the matcher and start it after the analyser.
- `SIGTERM` stops it together with the others.
- Add `post_analysed` (and `matches` for Phase 5) to the listener channels.

## Test cases (`apps/worker/src/match/matcher.test.ts`, worker test DB, seeded data)

Users:
- **Priya** (Phase 2 profile, plan trial, trial active);
- **Dan**, a designer (core figma and ui-design; plan standard);
- **Old**, a developer whose trial ended (plan trial, `trial_ends_at` yesterday);
- **Vee**, a video editor.

| # | Case | Expect |
|---|---|---|
| 1 | Post A (Next.js + Stripe, development) analysed → NOTIFY | matches for Priya (score 80, `pending`) and Old (`not_needed`, expired trial); none for Dan or Vee; the post's `match_status = done` |
| 2 | A vague post with no skills (categories design, development) | Priya and Dan get **broad** matches, `not_needed` (no AI); Vee none |
| 3 | A post below the threshold for Priya (the Postgres post) | match with score 0 and `not_needed` |
| 4 | A full_time post | no matches; `match_status = skipped` |
| 5 | A post 8 days old (e.g. re-analysed late) | no matches; done |
| 6 | A duplicate post | never claimed (`match_status = skipped` from Phase 3) |
| 7 | The same post matched twice (re-analysis) | rows unchanged (idempotent) |
| 8 | Priya dismissed post A, then post A is re-matched after a profile_version bump | status still dismissed, `ai_status = not_needed` |
| 9 | Backfill: Priya finishes onboarding with 3 posts from 1–2 days ago and 1 from 5 days ago | after one poll: matches for the 3 recent posts only; `rematch_since` cleared |
| 10 | Re-match after `bumpProfileVersion` (Priya adds `postgresql` as core) | the Postgres post's rule score rises; the row is updated, not duplicated |
| 11 | A post that makes `candidateUsersForPost` throw (stub the db function once) | the post goes back to pending, then succeeds on the next poll; the error is logged without post text |
| 12 | The SQL/core drift guard (stub the candidates to return a user core rejects) | the user is skipped and an error is logged |
| 13 | NOTIFY missed (listener closed) | the poll still picks the post up within `pollMs` |
| 14 | Concurrency: 10 posts at once with concurrency 4 | all matched, none twice |
| 15 | `stop()` during a batch | resolves within grace; no rows left `running` after the sweep |
| 16 | `MATCHING_ENABLED=false` | the matcher isn't started (`index.ts` wiring test, or an env test plus a small factory test) |
| 17 | Env defaults and bounds for the three new variables | parsed / refused |

## Done when

- Analysed posts and backfills produce correct `matches` rows automatically, and all 17 cases pass.
- The whole repo is green.
- "## Phase 4: done" is in the handoff: the matcher's API, the env names, how listeners are wired, and anything Phase 5 must know (e.g. NOTIFY `matches` timing).
