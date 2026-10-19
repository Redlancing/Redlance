# Phase 3: matching tables, plans, queues and the feed query

Model: **Opus** · Runs after Phases 1 and 2 · Migration `0010_matching`

## Why

Everything the matcher (Phase 4), re-scorer (Phase 5) and feed API (Phase 6) do goes through the functions defined here. Getting the SQL right matters most in three places:
- **the candidate SQL must agree with the core filters** (Phase 2);
- **the daily cap must be atomic**;
- **every queue write must be fenced** to the claim that owns it, the same pattern as `import_jobs` and the analysis queue.

## Schema (`packages/db/src/schema.ts`)

Mirror lists from core: `PLANS`, `MATCH_STATUSES`, `AI_STATUSES`, `MATCH_EVENTS`. Add them to the existing test that checks db mirror lists match core.

### `profiles`, new columns
| Column | Type | Notes |
|---|---|---|
| `plan` | text, enum `PLANS`, not null, default `'trial'` | Set by hand until billing exists |
| `include_unpaid` | boolean, not null, default false | Shows unpaid, commission and revshare posts |
| `rematch_since` | timestamptz, null | A pending re-match request: match posts since this time |
| `profile_version` | int, not null, default 1 | Bumped when matching-relevant profile data changes |

### `job_posts`, new columns (the matcher's queue)
| Column | Type | Notes |
|---|---|---|
| `match_status` | text, null, CHECK in (`pending`, `running`, `done`, `skipped`) | null = not analysed yet, or from before matching existed |
| `match_attempts` | int, not null, default 0 | |
| `match_locked_at` | timestamptz, null | |

Partial index on `(posted_at desc) WHERE match_status = 'pending'`, plus one on `(match_locked_at) WHERE match_status = 'running'`.

### `matches`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid v7, PK | |
| `user_id` | uuid, FK users, cascade | |
| `job_post_id` | uuid, FK job_posts, cascade | unique `(user_id, job_post_id)` |
| `rule_score` | int, 0–100 | |
| `broad` | boolean | |
| `features` | jsonb | the `Feature[]` from core |
| `rule_reason` | text, ≤ 160 | |
| `ai_status` | text, enum `AI_STATUSES` | |
| `ai_attempts` | int, default 0 | |
| `ai_run_after` | timestamptz, default now() | |
| `ai_locked_at` | timestamptz, null | |
| `ai_error` | text, null | error code only |
| `ai_score` | int, null, 0–100 | |
| `ai_reason` | text, null, ≤ 160 | |
| `ai_concerns` | text[], default `{}`, cardinality ≤ 3 | |
| `ai_model` | text, null | |
| `ai_scored_at` | timestamptz, null | |
| `best_project_id` | uuid, null, FK profile_projects, `SET NULL` | |
| `best_role_id` | uuid, null, FK profile_experience, `SET NULL` | |
| `score` | int, 0–100 | the final score: `ai_score` when done, else `rule_score` |
| `status` | text, enum `MATCH_STATUSES`, default `'new'` | |
| `profile_version` | int | |
| `created_at`, `updated_at` | timestamptz | |

Indexes:
- `(user_id, status)`;
- the AI queue: `(rule_score desc, created_at desc) WHERE ai_status = 'pending'`;
- `(ai_locked_at) WHERE ai_status = 'running'`;
- `(job_post_id)`.

The feed orders by the post's `posted_at`, so the feed query joins `job_posts`. Add an index that supports it and say which in the handoff.

### `match_events`
`id` (v7), `match_id` (FK, cascade), `user_id` (FK, cascade), `event` (enum `MATCH_EVENTS`), `created_at`. Index `(user_id, created_at)`.

### `rescore_usage`
`user_id` (FK, cascade), `day` (date), `used` (int ≥ 0). PK `(user_id, day)`.

## Changes to existing functions

- **`packages/db/src/ingest.ts` `completePostAnalysis`:** in the same statement or transaction, set `job_posts.match_status`:
  - `pending` when the analysis says `kind = hiring` **and** `employment_type <> 'full_time'` **and** `duplicate_of IS NULL`;
  - otherwise `skipped`.
  - Then `pg_notify('post_analysed', '')` when it's pending.
  - Export `POST_ANALYSED_CHANNEL = "post_analysed"`.
  - The re-analysis path (`requeueOutdatedAnalyses`) leads back through `completePostAnalysis`, which sets `pending` again. That's fine, because matching upserts.
- **`apps/web/src/server/onboarding/service.ts` `finishOnboarding`:** inside its transaction, call `requestRematch(tx, userId, now − BACKFILL_DAYS)` (core constant) so the new user's feed fills.

## New file: `packages/db/src/matches.ts`

Export from `packages/db/src/index.ts`. Channels: `MATCHES_CHANNEL = "matches"`.

**Post queue (matcher)**
- `claimPostsForMatching(db, limit)`: `UPDATE … SET match_status='running', match_attempts = match_attempts + 1, match_locked_at = now() WHERE id IN (SELECT … WHERE match_status='pending' ORDER BY posted_at DESC LIMIT n FOR UPDATE SKIP LOCKED) RETURNING id, match_attempts`.
- `completePostMatching(db, id, claim)`: fenced on `match_status='running' AND match_attempts = claim`, sets `done`.
- `failPostMatching(db, id, claim)`: back to `pending` until 3 attempts, then `skipped` with no error column (log only).
- `requeueStalePostMatching(db, olderThanMs = 120_000)`.

**Candidates**
- `loadMatchPost(db, postId) → MatchPost & { id, postedAt }`: joins the analysis.
- `candidateUsersForPost(db, post) → Array<{ userId, plan, trialEndsAt, profileVersion, profile: MatchProfile, existingStatus | null }>`:
  - One SQL query: active users with a profile **and**:
    - a shared skill (`EXISTS profile_skills … skill_id = ANY(post.skill_ids)`), or
    - the post has no skills and `profiles.categories && post.categories`.
  - User-level filters in SQL:
    - not (`remote_only` and post onsite);
    - pay (`include_unpaid` or pay in paid/unknown).
  - **Post-level filters** (kind, full-time, age, deadline) are checked once with core `passesFilters` before calling this.
  - Load `skills` (with levels) and `workSkillIds` (visible projects and roles) in the same query (`array_agg`) or one follow-up query for the candidate ids. **No N+1.**
- `candidatePostsForUser(db, userId, since) → MatchPost[]`: the reverse direction for backfill and re-match. Posts with `match_status IN ('done','pending')`, `duplicate_of IS NULL`, `posted_at ≥ since`, analysis kind hiring, plus the same candidate condition against this user.

**Matches**
- `upsertMatches(db, rows: NewMatch[])`, with `ON CONFLICT (user_id, job_post_id)`:
  - **same `profile_version` as stored** → do nothing; the re-run is idempotent;
  - **different version** → update the rule fields, `profile_version`, `score = rule_score`, the AI fields reset (`ai_status` from the new row, `ai_score`/`ai_reason`/best ids null, attempts 0);
  - **`status = 'dismissed'` is never changed**, and a dismissed pair always gets `ai_status = 'not_needed'`.
  - `NOTIFY matches` if any row is now `pending`.

**Re-match requests**
- `requestRematch(db, userId, since)`: `rematch_since = LEAST(COALESCE(rematch_since, since), since)`.
- `bumpProfileVersion(db, userId, now)`: `profile_version + 1`, then `requestRematch(now − REMATCH_DAYS)`. Not called by anything yet; it's the hook for profile edits.
- `claimRematch(db) → { userId, since } | null`: a CTE that selects the oldest request `FOR UPDATE SKIP LOCKED`, clears `rematch_since` and returns it. If processing fails, the matcher calls `requestRematch` again.

**AI queue (re-scorer)**
- `claimPairsForRescore(db, limit) → Array<{ matchId, claim }>`:
  - only `pending`, ordered by `rule_score desc`, then `created_at desc`;
  - only `ai_run_after ≤ now()`;
  - sets `running`, `ai_attempts + 1`, `ai_locked_at`.
- `takeRescoreUnit(db, userId, cap, day) → boolean`:
  ```sql
  INSERT INTO rescore_usage (user_id, day, used) VALUES ($1, $2, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET used = rescore_usage.used + 1
    WHERE rescore_usage.used < $3
  RETURNING used
  ```
  A row means true; no row means false. `cap ≤ 0` → false without a query.
- `refundRescoreUnit(db, userId, day)`: `used = GREATEST(used − 1, 0)`. Used when a provider error means no answer was produced.
- `loadRescoreContext(db, matchId) → { post, profile, projects, roles, userId, plan, trialEndsAt }`:
  - post: title, body (first 3,000 characters), analysis fields;
  - profile: category ids, skill names with levels, rate, remote;
  - **visible** projects (≤ 8: id, title, summary) and roles (≤ 6: id, title, organisation_description, summary);
  - **never `organisation`**.
- `completeRescore(db, matchId, claim, { aiScore, aiReason, concerns, bestProjectId, bestRoleId, model })`: fenced. Sets `done`, `score = aiScore`, `ai_scored_at`.
- `failRescore(db, matchId, claim, { code, retryable, countAttempt })`:
  - retryable and under 3 attempts → `pending` with backoff of 30 s × 2^(n−1) × jitter 0.8–1.2;
  - otherwise `failed`, and the score stays the rule score;
  - `countAttempt: false` gives the attempt back.
- `markCapped(db, matchId, claim)`: fenced, sets `capped`.
- `requeueStaleRescores(db, olderThanMs = 120_000)`.

**Feed**
- `feedPage(db, userId, { view: "best" | "all", cursor?: { postedAt, id }, categories?, pay?: "paid" | "any", limit }) → { items: FeedItem[], next: { postedAt, id } | null }`:
  - excludes `dismissed`;
  - `best` means `score ≥ BEST_MIN_SCORE`;
  - **keyset** on `(job_posts.posted_at, matches.id) DESC`;
  - `alsoPostedIn` from duplicates (Phase 1);
  - best project and role titles;
  - `FeedItem` lists everything Phase 6 returns: match id, score, reason (the AI reason if done, else the rule reason), broad, status, ai status, and the post fields.
- `setMatchStatus(db, userId, matchId, status) → { status } | null`: one transaction. Update only the caller's own match (null otherwise). Insert a `match_events` row only when the status actually changes.

## Test cases (`packages/db/src/matches.test.ts`, plus updates to `ingest.test.ts` and the web `service.test.ts`)

Seed helpers: users with profiles (Priya from Phase 2, plus a designer and a video editor), analysed posts. Reuse existing fixtures where possible.

| # | Area | Case | Expect |
|---|---|---|---|
| 1 | Schema | every CHECK: score out of range, bad enums, concerns > 3, `used < 0` | refused |
| 2 | Schema | `profiles.plan` default, `include_unpaid` default, `profile_version` default | trial / false / 1 |
| 3 | Mirror lists | db lists equal core lists | equal |
| 4 | completePostAnalysis | hiring freelance → `pending` + NOTIFY; full_time → `skipped`; for_hire → `skipped`; a duplicate → `skipped` | as stated |
| 5 | Post queue | 2 claimers race | each post claimed once; a stale claim can't complete (fencing) |
| 6 | Candidates | Priya + post A (skills) | Priya returned with skills, levels and workSkillIds |
| 7 | Candidates | the designer + a vague post with no skills (design) | returned as a candidate (broad) |
| 8 | Candidates | the video editor + post A | not returned |
| 9 | Candidates | a remote-only user + an onsite post | not returned |
| 10 | Candidates | an unpaid post: user with/without `include_unpaid` | returned / not |
| 11 | Candidates | a blocked user | not returned |
| 12 | **SQL ↔ core agreement** | for a matrix of ≥ 12 (post, profile) fixtures | `candidateUsersForPost` includes a user **iff** core `isCandidate !== null && passesFilters` |
| 13 | Candidates | no N+1 | one or two queries for 50 candidate users (count queries via a pg client wrapper, or assert by timing structure; explain the approach) |
| 14 | Reverse | `candidatePostsForUser(since = 3 days ago)` | only posts in the window, no duplicates, hiring only |
| 15 | Upsert | insert, then the same version again | unchanged (idempotent), and `updated_at` unchanged |
| 16 | Upsert | a new version with a different score | rule fields updated, AI fields reset |
| 17 | Upsert | an existing `dismissed` row and a new version | status stays dismissed, `ai_status = not_needed` |
| 18 | Upsert | NOTIFY | sent when any row is pending, not otherwise |
| 19 | Re-match | two requests (now−3d, then now−7d) | the stored `since` is the earlier one |
| 20 | Re-match | claim twice concurrently | one gets it, the other gets null; the request is cleared |
| 21 | Finish | `finishOnboarding` | `rematch_since ≈ now − 3 days` |
| 22 | AI queue | order | higher rule score first, then newer; broad matches (always `not_needed`) never claimed |
| 23 | **Cap** | 25 concurrent `takeRescoreUnit(cap 20)` | exactly 20 true |
| 24 | Cap | a new day | counting starts again |
| 25 | Cap | refund | `used` goes down, never below 0 |
| 26 | Rescore | complete | score = ai_score, status done |
| 27 | Rescore | fail, retryable | back to pending with `ai_run_after` in the future; after 3 → failed with score = rule_score |
| 28 | Rescore | a stale running row | requeued |
| 29 | Rescore context | a profile with organisation "Acme Realty" | context has `organisationDescription`, **no "Acme Realty" anywhere** (JSON.stringify check) |
| 30 | Rescore context | hidden projects | excluded |
| 31 | Feed | best vs all | best has only score ≥ 60 |
| 32 | Feed | keyset | page 1 then page 2 have no overlap or gap, **even after inserting a newer match between the calls** |
| 33 | Feed | dismissed | excluded |
| 34 | Feed | alsoPostedIn | lists the duplicates' communities |
| 35 | Feed | category and pay filters | applied |
| 36 | Status | own match | updated + one event |
| 37 | Status | the same status twice | no second event |
| 38 | Status | another user's match | null, nothing written |

## Done when

- All 38 cases pass, and the migration applies on a fresh database (`npm run db:reset`).
- The whole repo is green.
- "## Phase 3: done" is in the handoff: every exported function with its exact signature, the `FeedItem` type, the indexes, and any deviation.
