# Matching and the job feed (backend): conclusion

**Status (2026-10-18):**
- The whole backend is built: cross-post dedupe, the rule score, the matcher, the AI re-scorer, the feed API and the status reports. There is **no UI yet**.
- It lives in the working tree on `feat/ingestion`. **Nothing is committed.**
- Tests: **1,123 pass** (web 299, worker 435, core 173, db 190, llm 26). `typecheck`, `lint` and `npm run build` are clean.
- Smoke-tested on 2026-10-18: `ingest:status`, `match:status`, and the feed API over HTTP (401 signed out, 200 with an empty feed, 400 for a bad cursor or status `new`, 404 for an unknown match, 403 without an origin).
- **Not done yet:**
  - a live end-to-end run with real Reddit posts, real Vertex re-scores and a real onboarded profile;
  - the feed UI, alerts (Telegram or email) and drafts.
- Step 3 of the core loop (Match) is done. Alert, Draft and Learn are not.
- **AI re-scorer off for the MVP (decided 2026-10-19).** `RESCORE_ENABLED` now defaults to `false`. While it is off, the matcher queues nothing for AI (every match gets `ai_status = 'not_needed'`), and the feed shows the rule score and rule reason. Picking the project or role to cite moves to drafting: the draft call reads the post and the user's saved projects. The re-scorer code stays and is tested; set `RESCORE_ENABLED=true` to switch it back on. Dedupe stays as it is; the feed UI should link every community in `alsoPostedIn`, so the user can open each copy.

The plan and the build log are in `plan/` (`plan/README.md` for the design, `plan/build-notes.md` for what happened phase by phase). This file is the short, checked-against-the-code version.

## In one paragraph

Every post that ingestion has analysed is compared with every user's profile. A user is a **candidate** when the post asks for a skill they have (or, if the post names no skills at all, when it shares one of their job types: a "broad" match). Candidates get a **rule score** from 0 to 100, computed by plain code from skills, job type, budget, remote, past work and red flags. That score is stored at once as a `matches` row, so the post is in the user's feed immediately, with a short reason. If the score is 50 or more and the user's plan allows it, a second loop sends the pair to **Gemini Flash-Lite**, which gives a better score, a one-line reason and the project or role worth citing in a reply. Each user may have only a fixed number of these AI re-scores a day (15 on trial and Standard, 50 on Max). The feed API reads the table: newest first, "best" (score 60 or more) or "all".

## The big picture

```
 ingestion (already built)
 poller ─► saveJobPosts ─► STRICT DEDUPE ─► analyser ─► completePostAnalysis
                            (same author,     │            sets job_posts.match_status = 'pending'
                             near-identical   │            and NOTIFY post_analysed
                             copy: duplicate_of, never analysed)
                                              ▼
 apps/worker  ┌────────────────────────── MATCHER ─────────────────────────────────┐
              │ claim post (SKIP LOCKED) ─► load post + analysis                    │
              │ ─► post-level filters (core)                                        │
              │ ─► candidateUsersForPost (ONE SQL query)                            │
              │ ─► per user: core isCandidate + passesFilters (double-check)        │
              │              ruleScore ─► decideAiStatus                            │
              │ ─► upsertMatches (fenced by profile_version, analysed_at)           │
              │ ─► withdrawPostMatches ─► complete   ──► NOTIFY matches if pending  │
              │                                                                     │
              │ re-match requests (polled): backfill after onboarding,              │
              │   re-match after a profile change ─► same scoring, user side        │
              └─────────────────────────────────────────────────────────────────────┘
                                              │ matches.ai_status = 'pending'
                                              ▼
              ┌────────────────────────── RE-SCORER ───────────────────────────────┐
              │ claim pairs (best rule score first)                                 │
              │ ─► prepare: load context ─► plan allows AI? ─► take 1 daily unit    │
              │             ─► daily money budget ok?                               │
              │ ─► Flash-Lite call (prompt-injection safe, names scrubbed)          │
              │ ─► completeRescore: score = AI score, reason, best project/role     │
              └─────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
 apps/web   GET /api/v1/feed  (keyset cursor, best / all)
            POST /api/v1/feed/:matchId/status  (+ match_events)
```

Everything runs in the one worker process next to the poller and the analyser. Like the rest of the system there is no SQS: the queues are Postgres rows (`job_posts.match_status`, `matches.ai_status`) with `LISTEN/NOTIFY` for wake-ups and a 10-second poll as the safety net.

## Where the code is

| Part | Files |
|---|---|
| Pure matching rules (`@redlance/core`) | `packages/core/src/matching/`: `constants.ts` (thresholds, window lengths, status lists), `plans.ts` (plans, daily caps, `aiAllowed`), `score.ts` (`isCandidate`, `passesFilters`, `budgetFit`, `ruleScore`, `WEIGHTS`), `reason.ts` (the human reason line), `fx.ts` (rough currency rates) |
| Organisation-name scrubbing | `packages/core/src/client-names.ts` (`scrubOrganisations` and helpers; moved here from the worker's resume code, which re-exports it) |
| Dedupe | `packages/db/src/ingest.ts`: `saveJobPosts`, `markDuplicates`, `duplicateCommunities`, `normalizeTitle`; migration `0009_dedupe.sql` |
| Matching storage | `packages/db/src/matches.ts` (about 1,300 lines: post queue, candidate SQL, upsert, withdraw, re-match requests, AI queue and daily cap, feed query, status change); migrations `0010_matching.sql` and `0011_matching_fixes.sql`; schema in `packages/db/src/schema.ts` |
| Hand-off from analysis | `packages/db/src/ingest.ts`: `completePostAnalysis` and `POST_ANALYSED_CHANNEL` |
| Reports | `packages/db/src/match-stats.ts` (numbers), `apps/worker/src/cli/match-report.ts` (text), `match-status.ts`, `ingest-status.ts` |
| Matcher | `apps/worker/src/match/matcher.ts` |
| Re-scorer | `apps/worker/src/match/rescorer.ts` (the queue loop), `rescore.ts` (prompt, schema, one model call) |
| Wiring and settings | `apps/worker/src/index.ts`, `env.ts`, `.env.example` |
| Feed API | `apps/web/src/server/feed.ts` (cursor and response shape), `apps/web/src/app/api/v1/feed/route.ts`, `apps/web/src/app/api/v1/feed/[matchId]/status/route.ts` |
| Backfill trigger | `apps/web/src/server/onboarding/service.ts`: `finishOnboarding` calls `requestRematch` |

## The tables and columns added

| Table | Added | Why |
|---|---|---|
| `job_posts` | `duplicate_of` (self-reference, `on delete set null`) | Points a cross-post at the first copy |
| | `match_status` (`pending` / `running` / `done` / `skipped`, null before analysis), `match_attempts`, `match_locked_at` | The matcher's queue on the post itself, same pattern as `analysis_status` |
| `profiles` | `plan` (`trial` / `standard` / `max`, default `trial`) | Decides the daily AI cap. Set by hand in SQL until billing exists |
| | `include_unpaid` (default false) | Show unpaid, commission-only and revshare gigs |
| | `profile_version` (starts at 1) | Bumped when the profile changes; fences stale writes |
| | `rematch_since`, `rematch_claimed_at`, `rematch_attempts`, `rematch_after` | A re-match request with a lease and a backoff (see "Backfill and re-match") |
| `matches` (new) | one row per user and post (unique on `user_id` + `job_post_id`) | See below |
| `match_events` (new) | `match_id`, `user_id`, `event`, `created_at` | A log of every status change, for the later "Learn" step |
| `rescore_usage` (new) | `user_id`, `day`, `used` (primary key `user_id` + `day`) | How many AI re-scores a user has used today |

Also: migration `0009` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` (trigram text similarity, used by dedupe).

Columns of `matches`:

| Group | Columns |
|---|---|
| Identity | `id`, `user_id`, `job_post_id`, `posted_at` (a copy of the post's time, so the feed has one index), `created_at`, `updated_at` |
| Rule score | `rule_score` (0–100), `broad`, `features` (jsonb: every signal and its points), `rule_reason` |
| AI re-score | `ai_status` (`not_needed`, `pending`, `running`, `done`, `failed`, `capped`), `ai_attempts`, `ai_run_after`, `ai_locked_at`, `ai_error`, `ai_score`, `ai_reason`, `ai_concerns[]` (at most 3), `ai_model`, `ai_scored_at`, `ai_finished_at`, `ai_unit_day`, `best_project_id`, `best_role_id` |
| Final | `score` (= `ai_score` once done, else `rule_score`), `status` (`new`, `seen`, `saved`, `dismissed`, `replied`) |
| Fencing | `profile_version`, `analysed_at` (the analysis the score came from), `withdrawn_at` |

Constraints worth knowing: scores are 0–100; reasons are at most 160 characters; **`NOT broad OR ai_status = 'not_needed'`** (the database itself refuses to queue a broad match for AI).

Important indexes:
- `matches_feed_idx (user_id, posted_at DESC, id DESC) WHERE status <> 'dismissed' AND withdrawn_at IS NULL`: the feed's keyset index;
- `matches_ai_queue_idx (rule_score DESC, created_at DESC) WHERE ai_status = 'pending'`: the AI queue;
- `job_posts_match_queue_idx (posted_at DESC) WHERE match_status = 'pending'`: the matcher's queue;
- `job_posts_author_posted_idx (author, posted_at)`: dedupe lookups;
- `profiles_rematch_idx`: partial, where `rematch_since` is set.

## One post, end to end

### 1. Cross-posts are dropped at ingestion

A freelancer who posts the same gig in five subreddits would otherwise fill the feed with five copies and cost five analyses. `saveJobPosts` calls `markDuplicates` in the same transaction as the insert. A new post is a **copy** only if all of this holds (strict on purpose):

- same non-null author;
- the other post was posted within **72 hours** either way (`DEDUPE_WINDOW_HOURS`; the later copy can be stored first when feeds are polled out of order);
- the other post is an **original**: not itself a copy, and not a `skipped` post (a post that was never going to be analysed can't be the original);
- normalised titles (lower case, no emoji or symbols) at least **0.9** similar by `pg_trgm`;
- every **number** in the titles is equal ("$10" vs "$20" are different gigs; "React" vs "React Native" fails the title test);
- bodies: both filled and at least **0.8** similar over the first 2,000 characters (`DEDUPE_SIMILARITY`); both empty and the titles identical; one empty and one filled is never a copy.

The original is the one stored first. A copy gets `duplicate_of = <original>`, `analysis_status = 'skipped'` and `analysis_error = 'DUPLICATE'`, so it is never analysed or matched. The feed shows the copies as `alsoPostedIn` (the other communities) on the original. Rows are processed in insertion order and a row only picks an original that is not a copy, so chains cannot form.

Why strict: a missed duplicate costs one extra analysis; a false merge hides a real gig. A looser first version (title plus body at 0.6) merged agency templates, task series with different prices, and "React" with "React Native". No embeddings are used.

### 2. Analysis hands the post to the matcher

When the analyser finishes a post, `completePostAnalysis` sets `job_posts.match_status` in the same update:

```sql
case
  when <kind = 'hiring' and employment_type <> 'full_time'> and duplicate_of is null then 'pending'
  when exists (select 1 from matches m where m.job_post_id = job_posts.id
               and m.withdrawn_at is null and m.status in ('new', 'seen')) then 'pending'
  else 'skipped' end
```

The second branch matters on a **re-analysis**: if a post that already has live matches is now for-hire or full-time (or since marked a duplicate), the matcher must see it so it can withdraw them. When the result is `pending`, it also sends `NOTIFY post_analysed` on commit. It never resets `match_attempts`, so an old matcher's claim can't touch a newer one.

### 3. The matcher claims the post

`claimPostsForMatching` takes up to `concurrency` pending posts (`WORKER_CONCURRENCY`, default 4), newest first, with `FOR UPDATE SKIP LOCKED`, and bumps `match_attempts`. That number is the **claim**: `completePostMatching` and `failPostMatching` only work if the row is still `running` with the same `match_attempts`. A failure puts the post back to `pending` until 3 attempts, then `skipped`. A sweep every 60 s rescues posts stuck in `running` for over 2 minutes (a crashed worker).

### 4. Candidates: SQL first, then core checks them again

The post's own filters run once in core with a permissive profile (accepts onsite and unpaid), so only the post can fail them: it must be `hiring`, not `full_time`, at most 7 days old (`MATCH_MAX_AGE_DAYS`) and not past its deadline. Then `candidateUsersForPost` finds users in **one query** (skills and past-work skills are folded in with correlated subqueries, so 50 candidates is still one statement):

```sql
-- a user is a candidate when
exists (select 1 from profile_skills ps where ps.user_id = p.user_id
        and ps.skill_id = any(<post skill ids>))            -- shares a skill
-- or, if the post has no skills:  p.categories && <post categories>   -- shares a job type
and (not p.remote_only or <post remote> <> 'onsite')
and (p.include_unpaid or <post pay type> in ('paid', 'unknown'))
and u.status = 'active'
```

The same rules also exist as plain code in core (`isCandidate`, `passesFilters`). The matcher runs core on every row the SQL returns. If they ever disagree, the pair is skipped and logged as an error (`candidate query and core disagree`). That is a drift alarm: the SQL (fast) and core (readable, easy to test) must say the same thing. A 6-profile by 15-post test matrix checks them against each other in both directions.

### 5. The rule score

`ruleScore` adds up named signals (`WEIGHTS` in `score.ts`), clamps to 0–100, and keeps the breakdown in `matches.features`, so the weights can be tuned later from saves and dismissals.

| Signal | Points |
|---|---|
| Core skill the post asks for | +20 each, at most +60 |
| Secondary skill | +8 each, at most +24 |
| Shared job type | +15 |
| Budget fits the user's minimum rate | +10 |
| Budget below their minimum | -25 |
| Post skill also appears in the user's visible projects or roles | +10 |
| Post is remote and the user is remote-only | +5 |
| Red flag on the post | -15 each |

Budget fit converts currencies with rough fixed rates (`fx.ts`: USD 1, GBP 1.3, EUR 1.1, INR 0.012; they are for "above the minimum or not", not for money). Amounts are rounded to cents first (33 USD at 1.1 is 29.999... EUR otherwise), and a reversed range (min above max) uses the higher figure. Hourly budgets are compared with the minimum rate, daily ones with 8 times it, fixed ones with the minimum if the user takes fixed-price work; anything else is "unknown" and scores nothing.

`reason.ts` turns the features into a line such as `core skill (Next.js) · your job type · budget fits`, at most 120 characters, never showing raw ids.

### 6. Broad matches (posts with no skills)

Some posts name no skill at all ("need a designer, DM me"). If the post has no skills and shares a job type with the user, the match is **broad**:
- the skill and past-work signals are skipped, and the score is capped at 45 (with today's weights it can't exceed 30 anyway);
- the reason starts with "Broad match: shares your job type";
- `ai_status` is always `not_needed`: **broad matches never go to AI**, and a database CHECK enforces it. Reason: an "only when nothing else is pending" rule would still spend the daily units between polls and starve strong matches that arrive later. A later option is to spend leftover units on broad matches at the end of the user's day.

### 7. `ai_status`

`decideAiStatus` returns `pending` only when all of these hold; otherwise `not_needed`:
- the user's existing match is not dismissed;
- the plan allows AI (`aiAllowed`: Standard and Max always; trial only while `trial_ends_at` is in the future, so expired trials keep rule scores only);
- the match is not broad;
- the rule score is at least `RESCORE_THRESHOLD` (default 50).

### 8. Saving: the fenced upsert

`upsertMatches` inserts rows (chunks of 500, one transaction) and, on a conflict, replaces a stored row **only if `(profile_version, analysed_at)` is strictly newer**:

```sql
on conflict (user_id, job_post_id) do update set ...
where (matches.profile_version, matches.analysed_at) < (excluded.profile_version, excluded.analysed_at)
```

Effects:
- the same pair again does nothing, so re-runs are safe;
- a slow matcher holding an old snapshot can't overwrite a newer one, so neither the profile version nor the analysis can move backwards;
- a re-analysis or a profile change replaces the rule fields, resets all AI fields (including the unit the old version held, so a new profile version pays for its own re-score), and clears `withdrawn_at`;
- a **dismissed** match stays dismissed and becomes `not_needed`.

If any written row is `pending`, it sends `NOTIFY matches` on commit to wake the re-scorer. Unchanged rows write nothing and send nothing.

### 9. Withdrawing matches that no longer qualify

After the upsert, `withdrawPostMatches` sets `withdrawn_at` on **`new` and `seen`** matches of that post that no longer qualify: the user is no longer a candidate, or the post itself fails the filters (re-analysed as for-hire or full-time, now a duplicate, too old, deadline passed). A pending AI re-score is cancelled (`not_needed`); a running one finishes but the row stays withdrawn. `saved`, `replied` and `dismissed` matches are the user's history and are never withdrawn. Rows scored from a *later* analysis than the one this matcher saw are left alone. The feed and the AI queue both skip withdrawn rows. After the post is handled, `completePostMatching` marks it `done`.

### 10. Backfill and re-match

Users need matches for posts that were analysed before they existed. This is the same scoring run from the user's side:
- `requestRematch(userId, since)` writes `profiles.rematch_since` (requests merge: the earliest `since` wins). `finishOnboarding` calls it with the last **3 days** (`BACKFILL_DAYS`). **A profile edit does not re-match** (decided 2026-10-20; the `bumpProfileVersion` hook and `REMATCH_DAYS` were removed): existing matches keep the scores from the old profile, and posts that arrive after the edit are scored with the new one. The backfill is the only caller.
- Every matcher poll serves up to 20 requests, one at a time. `claimRematch` takes a **lease** (`rematch_claimed_at`, valid 5 minutes), so a crashed matcher loses nothing: the lease expires and the request is claimed again.
- `candidatePostsForUser` is the reverse of step 4: this user's candidate posts since `since`, newest first, from originals whose `match_status` is `done`, `pending` or `running` (upserts are idempotent, so racing the post's own matcher is harmless). It is driven by the `posted_at` index, so its cost follows the window, not the table.
- Then `upsertMatches`, then `withdrawStaleUserMatches` (the user's matches in that window that are still on an older `profile_version` were not produced by the new profile, so they are withdrawn), then `completeRematch`.
- `completeRematch` clears the request only if `rematch_since` and the lease still match. A new request that arrived meanwhile clears the lease, so it survives for the next poll.
- A failure calls `failRematch`: backoff `30 s × 2^(attempts − 1)`; after 5 claims (`MAX_REMATCH_ATTEMPTS`) the request is dropped and logged as an error. A shutdown gives the attempt back without a backoff. `dropAbandonedRematches` drops requests whose last claim crashed every time. One bad request never blocks the others.
- Migration `0011` also queued the last 7 days of already-analysed originals (`match_status = 'pending'`) so posts that existed before matching was built get matched.

### 11. The re-scorer: who may spend what

`claimPairsForRescore` takes up to `concurrency − running` due `pending` pairs, **highest rule score first** (then newest), skipping withdrawn rows. The rule score of the first pairs is what the user's daily units are spent on, so each pair goes through `prepare` **one at a time in claim order** before any model call starts:

1. `loadRescoreContext`: post, profile, visible projects (up to 8) and roles (up to 6). Gone: fail with `NO_CONTEXT`.
2. The profile version must still match the claim, else the pair is let go (`PROFILE_CHANGED`) without a unit or a call.
3. `aiAllowed`? If the trial ended since matching: `capped` with `ai_error = 'NOT_ALLOWED'`.
4. **`takeRescoreUnit`**: one unit of today's cap (`RESCORE_DAILY_CAP`: trial 15, standard 15, **max 50**). Result `taken`, `held`, `capped` or `lost`.
5. Global daily money budget not exceeded.
6. Only then is the model call started (in parallel, up to `WORKER_CONCURRENCY`).

**One unit per pair per day.** `takeRescoreUnit` is one SQL statement. It locks the row (`FOR UPDATE`), and inserts or increments the user's `rescore_usage` row only while `used < cap`. It writes the UTC day on the pair (`ai_unit_day`):

```sql
insert into rescore_usage (user_id, day, used) values (…, $day, 1)
on conflict (user_id, day) do update set used = rescore_usage.used + 1
  where rescore_usage.used < $cap
```

- `held`: the pair already took today's unit in an earlier attempt (for example after invalid model output), so a retry costs nothing more.
- `capped`: no units left, so `ai_status = 'capped'`; the rule score stays.
- `lost`: the claim no longer owns the row; nothing is taken.
- The conditional upsert plus the row lock keep 25 concurrent callers within the cap (tested: exactly 20 `taken` and 5 `capped` for a cap of 20).

**Give-backs.** If no answer came of the attempt (provider outage or rate limit, worker shutdown, daily budget reached, a database error before the call), `failRescore` returns **the attempt and the unit** in the same statement (decrementing `rescore_usage` for the day stored on the row, never below 0). The pair becomes due again after 5 seconds (`GIVE_BACK_DELAY_MS`), so a pair-specific error can't loop hot. Counted failures (invalid output, timeouts, bad request) keep the unit, back off `30 s × 2^n` with jitter, and fail for good after 3 attempts with the score left at the rule score. The statement is fenced on the claim, so a second call refunds nothing. The stale sweep (running for over 2 minutes) refunds requeued pairs, grouped by user and day.

An error in `prepare` itself gives back only **once in a row** (`countRepeats`): a bug that always throws ends as `failed` after 4 claims instead of retrying forever.

**Circuit breaker.** Three provider failures in a row (rate limit, quota, server error) pause claiming for 1 minute, doubling per trip up to 15 minutes. A success resets it.

**Daily budget.** `RESCORE_DAILY_BUDGET_USD` (default $5) caps spend for all users: the sum of `llm_usage` rows with task `match_rescore` since UTC midnight, re-checked at most once a minute. Over budget: no new claims, and pairs wait until tomorrow (UTC).

### 12. The model call

`rescore.ts` builds one prompt per pair and calls Flash-Lite (`VERTEX_MODEL_FAST`) with temperature 0, thinking off, a 10 s timeout, one retry and at most 300 output tokens. A whole pair has 20 s (`PAIR_TIMEOUT`).

Prompt layout:

```
<post>
Title: …
<first 3,000 characters of the body>
Analysis: freelance, pay paid, budget 400-600 USD fixed, remote, deadline 2026-11-01
Job types: Development
Skills: Next.js, Payments integration
Red flags: none
</post>
<profile>
Job types: … / Core skills: … / Secondary skills: … / Rate: from 30 USD (hourly or fixed-price) / Remote: …
Projects:
[P1] title: summary
Roles:
[E1] title (organisation description): summary
</profile>
Task: match_rescore   + the score bands, reason and concerns rules
```

Output (checked by a zod schema): `score` 0–100, `reason` (cleaned to at most 120 characters), `bestProject` and `bestRole` (**only the ids shown in the prompt, or null**, so the model can't invent a project), and up to 3 `concerns` of at most 40 characters.

**Prompt injection.** The post is untrusted text written by strangers. The system message says never to follow instructions inside it, and every line inside `<post>` and `<profile>` has `<` turned into `‹` and `>` into `›`. Nothing is deleted, so a trick such as `</pos</post>t>` cannot rebuild a closing tag. The model never sees our uuids, only `P1`, `E1`. An empty or invisible-characters-only reason counts as invalid output (the cost is still recorded, the attempt counts).

**Organisation names.** The model only sees what the user's role says about an employer in a description ("a real-estate agency"), never the name. `loadRescoreContext` reads every role's organisation (hidden roles too, since a visible project can name a hidden role's employer) and `scrubOrganisations` replaces it, in any case or spacing, in project titles and summaries and in role titles, summaries and descriptions, with the description (or "the company" when there is none or the description would put the name back). The scrubbing code is shared with the resume import (`client-names.ts`).

**Saving.** `completeRescore` stores the verdict and sets `score = ai_score`. The best project or role is saved as null if it was deleted between loading and saving (a `FOR KEY SHARE` subselect makes the check safe against a concurrent delete), so a verdict is never lost to that. Every attempt, failed ones included, is written to `llm_usage` with `user_id`, `job_post_id`, `task = match_rescore` and its cost, before the match row is updated. Logs carry ids and codes only, never post or profile text.

### 13. The feed API

`GET /api/v1/feed?view=best|all&cursor=&type=a,b,c&pay=paid|any&limit=1-50` (default `view=best`, `pay=any`, `limit=20`):

- **best** keeps `score >= 60` (`BEST_MIN_SCORE`); **all** keeps everything. Both exclude `dismissed` and withdrawn matches and posts that are duplicates.
- `type` filters by job type (at most 3, validated against the taxonomy); `pay=paid` keeps paid posts only.
- Newest **post** first, by `(matches.posted_at, matches.id)`.
- **Keyset cursor, not offset.** The cursor is base64url of `<postedAt ISO>|<match id>`; the next page is `where (posted_at, id) < (cursor)`. New matches arriving between pages can't shift a page, and the query uses `matches_feed_idx` (its predicate is exactly the two exclusions). The query asks for `limit + 1` rows to know if there is a next page. A cursor that doesn't decode is a 400.
- Each item has the final `score`, the `reason` (the AI reason when `ai_status` is `done`, else the rule reason), `broad`, `status`, `aiStatus`, `bestProject` / `bestRole` (null when hidden or deleted), and the post fields (title, community, url, postedAt, summary, categories, budget, payType, remote, deadline, redFlags, `alsoPostedIn`).
- The feed never waits for the AI: a new match shows with its rule score at once, and the AI score replaces it.

`POST /api/v1/feed/:matchId/status` with `{ "status": "seen" | "saved" | "dismissed" | "replied" }` returns `{ status }`. `new` is refused (400), a malformed id is 400, and a match that isn't the caller's is 404. `setMatchStatus` locks the row, changes the status and writes one `match_events` row, in one transaction, **only when the status actually changes**. Dismissing a match still waiting for AI cancels the re-score (`not_needed`). Dismissing while the re-score is already running does not cancel it (the unit is spent; the result is saved on the dismissed row). Un-dismissing leaves `not_needed` as it is.

Both routes use `apiRoute()` (session, origin check, input validation, rate limit), like every other route.

## Cost of the re-score

Prices in `packages/llm/src/prices.ts` for Flash-Lite ($0.10 per million input tokens, $0.40 per million output) are **unverified placeholders**; confirm them on the official Vertex page.

| Case | Input | Output | Per call |
|---|---|---|---|
| Typical (1,200-character body, 3 projects, 2 roles) | about 930 tokens | about 80 | about $0.000125 |
| Worst (3,000-character body, every project and role at its length limit, code-heavy text) | about 2,500 tokens | about 120 | about $0.0003 |

- A retry after invalid output doubles one call's cost.
- Per user per month at the cap: Standard and trial (15 a day, about 450 calls) is about $0.06 typical, $0.14 worst. **Max (50 a day, about 1,500 calls) is about $0.19 typical, $0.45 worst, $0.70 worst with some retries.** All small next to a $8–20 subscription.
- The $5 daily budget default is about 40,000 typical calls.

## Settings (`apps/worker/.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `DEDUPE_SIMILARITY` | 0.8 (0.3–0.95) | Body similarity needed to call a post a copy |
| `DEDUPE_WINDOW_HOURS` | 72 (1–336) | How far apart (either way) two copies may be posted |
| `MATCHING_ENABLED` | true | Run the matcher (and, with the next setting, the re-scorer) |
| `RESCORE_THRESHOLD` | 50 (0–100) | Rule score needed for an AI re-score |
| `MATCH_MAX_AGE_DAYS` | 7 (1–30) | Posts older than this are never matched |
| `RESCORE_ENABLED` | false (off for the MVP, 2026-10-19) | Run the re-scorer (needs `MATCHING_ENABLED`). While false, the matcher queues no match for AI |
| `RESCORE_DAILY_BUDGET_USD` | 5 (0–1000) | Daily model spend cap for re-scores across all users (UTC day) |
| `WORKER_CONCURRENCY` | 4 | Shared by the analyser, import runner, matcher and re-scorer |
| `VERTEX_MODEL_FAST` | `gemini-3.5-flash-lite` | The re-score model |

Fixed in code, not env: the plan caps (`RESCORE_DAILY_CAP` in core), `BEST_MIN_SCORE` 60, `BACKFILL_DAYS` 3, the rule weights, 3 attempts per post and per pair, 5 per re-match request.

Wiring in `index.ts`: the matcher and the re-scorer each get their own `LISTEN` connection (`post_analysed`, `matches`), start after the analyser and stop with the others (20 s grace). The database pool is `WORKER_CONCURRENCY * 4 + 4`.

## How to run and check it

```sh
npm run ingest:status -w @redlance/worker                        # now has a Matching section
npm run match:status -w @redlance/worker -- you@example.com      # one user (APP_ENV must be local or test)
```

`ingest:status` prints:

```
Matching
  Posts (24 h): 2 pending, 1 running, 3 done, 1 skipped
  Matches (24 h): 6 created, 1 broad
  AI (24 h): 1 done, 1 capped, 1 failed · 2 pending now
  Re-score spend today (UTC): $0.0123 · 2 users at cap
```

"AI (24 h)" counts by `ai_finished_at` (set when a pair becomes done, capped or failed), so a later save or dismissal doesn't move a pair in or out of the window; "pending now" is the whole backlog. `Duplicates (24 h)` is printed by the ingestion section. `match:status` shows the user's plan, re-scores used against the cap, counts by `ai_status` and `status`, and their top 5 matches.

To try a user by hand: set `profiles.plan` in SQL (`update profiles set plan = 'max' where …`); there is no billing yet.

## Decisions worth remembering (and why)

- **Match on arrival** (fan-out on write), plus backfill and re-match. Alerts need matches before anyone opens the feed, and a feed read becomes one indexed query.
- **Rules first, AI second.** Rules decide who might fit and are free and instant; the AI only judges pairs that already scored 50 or more, where it changes the ranking and where the reason matters. No embeddings in v1: they mostly agree with the rules and can't see constraints such as in-house only, equity only or senior only.
- **The feed never waits for AI.** The rule score and reason show at once.
- **Full-time roles are excluded.** Redlance is for freelance gigs. Unpaid, commission-only and revshare are hidden unless `include_unpaid`.
- **No AI for non-payers.** Expired trials keep rule scores only.
- **Postgres is the queue**, with NOTIFY and SKIP LOCKED, as in onboarding and ingestion.
- **Every write is fenced** (claim numbers, `profile_version`, `analysed_at`, the re-match lease), so a slow or crashed worker can never overwrite newer work.
- **`matches.posted_at` is a denormalised copy** of the post's time. An index can't span two tables, and this gives the feed a real keyset index.
- **Plans and caps:** trial 15, Standard (about $8–10 a month) 15, Max ($20 a month) 50 AI re-scores a day. Agency is undecided.

## Trade-offs chosen in the last review round (F5)

- **A profile edit can cost up to one unit per in-flight pair.** A new `profile_version` resets a pair's AI fields so it pays for its own re-score. A unit the old version held but whose pair is mid-call is not refunded (its fenced refund is a no-op). Otherwise every profile edit would re-score today's pairs for free.
- **Post text and custom skill names are not scrubbed.** Only the user's own organisation names are removed. The post is the client's own text, and custom skill names are the user's own words.
- **Give-backs retry after 5 seconds, not with a growing backoff.** A pair that gets a provider error every time while other pairs succeed (so the breaker never trips) is retried every 5 s, and each try writes two zero-token `llm_usage` rows. Rate limits are rarely per pair, so this was left.
- **The daily cap is first come, first served** by rule score at the moment of claiming; there is no smarter budgeting (rising threshold, reserve, batching).

## Known gaps and deferred items

- **No live end-to-end run** with real Reddit posts, real Vertex calls and a real onboarded profile, and the Flash-Lite prices are placeholders.
- **No UI, alerts or drafts.** The API exists; nothing in the web app calls it yet.
- **No re-match after a profile edit** (decided 2026-10-20). A profile edit (`/profile`, `docs/onboarding/profile-edit.md`) bumps `profile_version` without requesting a re-match: new posts are scored and stored with the new version, existing matches keep theirs (and a re-analysed post's match is replaced by the newer version, as the fencing allows). `withdrawStaleUserMatches` only runs on the backfill path.
- **`ai_status` is decided when a row is written.** An unchanged row (same `profile_version`, same analysis) isn't written again, so changing a user's `plan` or the threshold doesn't re-evaluate existing matches until the next profile version or a re-analysis.
- **`match_events` has no `new` event.** `new` is the starting state; a row is written only when `setMatchStatus` changes the status.
- **Rule weights are starting guesses.** The breakdown is stored in `features` so they can be tuned from saves and dismissals.
- **No location matching** for onsite gigs. Currency rates are rough constants updated by hand.
- **Dedupe is conservative.** Cross-posts by different accounts, or with reworded titles, are not caught.
- **Deferred ideas:**
  - smarter cap budgeting (a rising threshold during the day, a reserve for late strong matches, batching);
  - spending leftover units on broad matches at the end of the user's day;
  - measuring how often posts have no skills (if above about 25% of hiring posts, revisit "implied skills");
  - a small floor for give-back retries.
- **Deployment:** run migrations `0009`–`0011` (and the `pg_trgm` extension) before the new worker takes traffic. Worker container notes are in `CLAUDE.md`.

## Tests

`npm test` never calls Reddit or Vertex: the model is stubbed (`apps/worker/test/stub-llm.ts`, which scores a pair from the prompt's skills).

| Area | Where |
|---|---|
| Rule score, filters, reasons, fx, plans | `packages/core/src/matching/*.test.ts`, `client-names.test.ts` (core: 173 tests in all) |
| Dedupe, candidate SQL (matrix against core), upsert fencing, withdraw, re-match lease, AI queue and cap (25 concurrent takers), give-backs, stale sweep, feed, status | `packages/db/src/matches.test.ts`, `ingest.test.ts`, `match-stats.test.ts` (db: 190) |
| Matcher loop, re-scorer loop, prompt and schema, env | `apps/worker/src/match/*.test.ts`, `env.test.ts`, `cli/match-report.test.ts` (worker: 435) |
| Feed API and cursor | `apps/web/src/app/api/v1/feed/feed.test.ts`, `apps/web/test/feed-fixtures.ts` (web: 299) |

Totals on 2026-10-18: web 299, worker 435, core 173, db 190, llm 26 = **1,123**. The riskiest SQL (the pay filter, the broad condition, the cap, the refunds) was mutation-checked: each broken on purpose makes a test fail.
