# Subreddit insights: conclusion

**Status (2026-10-21):**

- The whole feature is built: the hourly refresh, the `subreddit_insights` table, the API, the `/insights` pages and the line on the match page.
- It lives on `feat/insights` (from `feat/ui`), committed, not merged, not pushed.
- Tests at the end: **core 338, db 372, worker 636, web 691**.
- Browser-checked on 2026-10-21 against the preview db `redlance_ui_preview` (production build): the Yours tab, Browse all, a subreddit page, the match-page line, and phone width (390 px).
- Two fixes came out of that pass: "fits your skills" was renamed **"strong fits"** (score 60 or more), and the detail grid no longer overflows on phones.
- One fresh review: 0 high, 3 medium, 7 low. Eight are fixed (listed below); two are open (see the gaps).
- **Migrations `0018` and `0019` are not applied to the dev db `redlance` yet.** Run `npm run db:migrate`, then `npm run insights:refresh -w @redlance/worker`.

The design is `design.md` and the build plan is `plan/README.md`. Delete `plan/` once you have read this file. Where they differ from this file, this file (checked against the code) is right.

## In one paragraph

For each subreddit we show eleven numbers that help a freelancer decide where to look: how much hiring happens there, how much of it is a strong fit, what it pays, when it is posted, how risky and how crowded it is. Ten of the eleven are the same for every user, so the worker computes them **once an hour** into one table, `subreddit_insights`. The web API reads that table, hides every number that has fewer than 20 data points, and shapes the rest for the page. Only "strong fits" is per user and is read live from `matches`. There are **no new AI calls**: everything comes from posts, their one analysis, and the user's matches.

## The big picture

```
 worker (one process holds the poller lock)            web (on request)
 ┌────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
 │ createInsightsRefresher                │   │ GET /api/v1/insights?tab=yours|all       │
 │   start() when the lock is taken,      │   │ GET /api/v1/insights/:subreddit          │
 │   then every hour                      │   │   insightsViewer: plan + trial check     │
 │ refreshSubredditInsights(db, now)      │   │   insightRows (the shared table)         │
 │   advisory lock ─► one SQL statement   │   │   + userFitCounts(Many) (per user)       │
 │   ─► upsert rows, delete stale rows    │   │   + latestMatchesIn (per user)           │
 └───────────────┬────────────────────────┘   │   gate every number at 20 (rule 8)       │
                 ▼                            │   hours shifted to the user's time zone  │
        table subreddit_insights ────────────►│                                          │
        (raw counts, one row per subreddit)   └───────┬──────────────────────────────────┘
                                                      ▼
                          /insights (Yours | Browse all), /insights/[subreddit],
                          and one line under the post facts on /feed/[matchId]
```

## How it works, step by step

### 1. The hourly refresh (worker)

- `apps/worker/src/insights/refresher.ts` makes the refresher. It runs `refreshSubredditInsights` straight away, then every hour (`INSIGHTS_REFRESH_INTERVAL_MS`).
- It does **not** have its own lock. The poller already elects one process in the whole system (the "poller lock"). In `apps/worker/src/index.ts` the poller is given `onLockAcquired: () => insights?.start()` and `onLockReleased: () => insights?.stop()`. So only the process that polls Reddit refreshes insights, and two workers never refresh together.
- The lock can move between processes or flap. The refresher remembers `lastRunAt` across stop and start, so a new pickup waits out the rest of the hour instead of recomputing at once (review fix L4).
- It never throws out of the loop. A failure is logged and retried the next hour.
- Switch: `INSIGHTS_ENABLED` (default true, needs `INGEST_ENABLED=true`).
- CLI: `npm run insights:status -w @redlance/worker` (row count, oldest `computed_at`, busiest subreddits) and `insights:refresh` (run once).

### 2. The refresh SQL (`packages/db/src/insights.ts`)

`refreshSubredditInsights(db, now)` is one transaction. It first takes an advisory lock, then runs one statement made of CTEs (named sub-queries):

```ts
const got = await tx.execute(sql`select pg_try_advisory_xact_lock(${INSIGHTS_REFRESH_LOCK_KEY}) as ok`);
if (!got.rows[0]?.ok) return { upserted: 0, deleted: 0, skipped: true };
```

- The lock lets the worker and the CLI skip each other instead of upserting over each other (review fix L6). It is released when the transaction ends. A skipped run says so in the log.
- The statement reads posts from the last 56 days (this window of 28 days, plus the 28 before it, for trends). `now` is a parameter so tests can pin the windows.
- Counting rules, each pinned by a test:
  - A **hiring post** is a post whose analysis says `kind = 'hiring'`. A cross-post copy (`duplicate_of` set) counts in its own subreddit and uses its original's analysis, because analyses exist only for originals (`left join job_post_analyses a on a.job_post_id = coalesce(p.duplicate_of, p.id)`).
  - "For hire" posts count by `coalesce(analysis kind, pre_kind)`, so ones skipped before analysis still count. `other` posts count nowhere.
  - A post's budget is the midpoint of min and max, or the one value given. Zero is no value. Percentiles (p25, median, p75) use `percentile_cont` per `(currency, budget_unit)` and are **never converted** between currencies.
  - Busiest hours are stored as `hour_slots int[336]`: UTC half-hours of the week, Monday 00:00 = 0. Half-hours so India's +5:30 lines up.
  - **Repeat client:** the same author has an earlier hiring post (not another copy of the same gig) in any subreddit in the 180 days before. Authors that are null or `[deleted]` are excluded. The query repeats the date bounds so the planner uses the `posted_at` index.
- The result is upserted (`on conflict (subreddit) do update`). Rows for subreddits with no post in the 56 days are deleted. Running twice gives the same rows.
- **Raw counts only.** The table holds counts, jsonb histograms and percentiles. Thresholds and wording are applied when reading, so they can change without a recompute.

### 3. Why a precomputed, shared table

Ten of the eleven insights are the same for everyone, change slowly, and cost a scan of weeks of posts. Computing them for each request would repeat that scan for every user. So we pay for it **once an hour** and every user reads one small row. It is Postgres, not Redis: it is durable, queryable, and one row per subreddit is tiny (about 238 rows). This is the "shared, expensive, slow-changing" case where precomputing pays off.

### 4. Why only "strong fits" is per user

"Strong fits" answers "how much of this subreddit fits me?". That depends on the user's profile, so it cannot live in the shared row. It is computed at request time from the indexed `matches` table:

```sql
select count(*) as hiring,
       count(*) filter (where exists (
         select 1 from matches m
         where m.user_id = $1 and m.job_post_id = coalesce(p.duplicate_of, p.id)
           and m.withdrawn_at is null and m.score >= 60)) as best
from job_posts p
join job_post_analyses a on a.job_post_id = coalesce(p.duplicate_of, p.id) and a.kind = 'hiring'
where p.community = $2 and p.posted_at >= $3
```

- Numerator and denominator are the same posts, counted by their own `posted_at`, so the first never exceeds the second.
- "Strong" means score `BEST_MIN_SCORE` (60), the same as the feed's Best view.
- `$3` is `max(window start, onboarded_at)`. A new user is not told "1 in 20" about posts that were posted before they had a profile.
- The Yours list needs this for many subreddits. `userFitCountsMany` does it in **one grouped query** instead of one per row (review fix M2).

### 5. Rule 8: the 20-data-point gate

`apps/web/src/server/insights.ts` turns raw rows into responses. Every insight is one of three shapes (`packages/core/src/insights/types.ts`):

```ts
type Insight<T> =
  | ({ status: "ok" } & T)
  | { status: "not_enough"; have: number; need: number }   // "Not enough data yet (12 of 20)"
  | { status: "building"; days: number };                  // "Building history"
```

`gated(n, build)` runs `build` only if `n >= INSIGHT_MIN_POINTS` (20). Below that the browser gets `have` and `need` and **no number**. So a small count can never leak to the page or be guessed from the network tab. Each insight names its own `n`:

- hiring posts in the window for most;
- budgets in that currency and unit (up to 3 groups shown, largest first; a group under 20 is dropped);
- known-author posts for repeat clients;
- hiring posts since `max(window start, onboarded_at)` for strong fits;
- skills also need at least 3 mentions each (`SKILL_MIN_MENTIONS`), top 5.

Wording follows rule 8: "posted budgets", never "market rate".

### 6. How collection start gates history

The table stores `history_start`: the earliest `first_seen_at` in `job_posts` (migration `0019` adds an index on it). It is **when we started collecting**, not the oldest `posted_at`. This matters because a first poll stores old posts that were already on the page. If we used `posted_at`, a brand new install would look like it had weeks of history.

The web code uses it in three ways:

```ts
historyDays(row)       // days between history_start and computed_at
coveredDays(row)       // min(28, historyDays): days of the window we actually collected
hasTrendHistory(row)   // history_start <= window_start - 28 days: the previous window is real
```

- **Posts a week** = `hiringPosts / (coveredDays / 7)`, so a new install is not divided by 4. Under 7 covered days it is `{ status: "building", days }`.
- **Trend** ("up from 28") only shows when `hasTrendHistory` is true and the previous window has 20 or more posts.
- **Repeat clients** shows "Building history" until `hasTrendHistory`, because it needs history before the window.

(Review fix M1.) For the first 7 days after collection starts, posts a week and trends show "Building history". That is by design.

### 7. The API (`apps/web/src/app/api/v1/insights/`)

- `GET /api/v1/insights?tab=yours|all`. Both routes use `apiRoute()` with the default bucket.
  - **Yours:** `userInsightSubreddits` lists subreddits where the user has at least one match (not withdrawn) on a post from the last 30 days, most matches first. A match counts in every subreddit its post or a copy was posted in. Rows come with the per-user fit.
  - **Browse all:** every `active` subreddit that has an insight row, sorted by hiring posts. No fit column.
- `GET /api/v1/insights/:subreddit` returns all eleven insights plus the user's 5 latest matches from it (`latestMatchesIn`, which reuses the feed query). The name is lowercased and checked against `^[a-z0-9_]{2,21}$`. An unknown subreddit is 404.
- `insightsViewer(userId)` runs first on both. No profile: 404 `NOT_FOUND`. Plan check `insightsAllowed(plan, trialEndsAt, now)` fails (trial ended): 403 `INSIGHTS_LOCKED`. Paid plans always pass; the trial passes before its end. The check is one function so it can move later.
- The browser never gets a username (rule 7). Repeat clients is a percentage only.
- Hours are shifted from UTC slots to the **profile's time zone** (`slotsToLocalHours`, `busiestStretch`, `weekPattern` in `packages/core/src/insights/format.ts`), using the zone's current offset.

### 8. The pages and the match-page line

- **`/insights`** (nav item "Insights"): tabs **Yours** and **Browse all** (with a filter box). Dense rows: subreddit, posts a week with trend, strong fits, main posted budget, red-flag rate. States: locked, building, empty (points to Browse all) and error. Server-rendered first view, like the feed.
- **`/insights/[subreddit]`**: the eleven insights as compact sections (number first, one plain sentence), the hours as a 24-bar chart with the busiest 4-hour stretch, the user's latest matches, and an "Open r/x" link.
- **Match page:** `matchInsightLine` adds one line under the post facts, for example "r/x: ~35 hiring posts a week · posted budgets USD/hour $15-35". It is `null` when the user can't see insights or nothing passes the threshold, and it never fails the page. It loads **in parallel** with the other page data (review fix L8).
- **Phone:** one column; the tab bar keeps five items and Settings moves to the top bar's menu.

## Where the code is

| What | Where |
|---|---|
| Thresholds, plan check, response types, hour maths, wording helpers | `packages/core/src/insights/` (`constants.ts`, `plans.ts`, `types.ts`, `format.ts`) |
| Table and migrations | `packages/db/src/schema.ts` (`subredditInsights`); `packages/db/migrations/0018_subreddit_insights.sql`, `0019_insights_collection_start.sql` |
| Refresh SQL and readers | `packages/db/src/insights.ts` (`refreshSubredditInsights`, `insightRows`, `userInsightSubreddits`, `userFitCounts`, `userFitCountsMany`, `latestMatchesIn`) |
| Hourly job | `apps/worker/src/insights/refresher.ts`; wired in `apps/worker/src/index.ts` and `apps/worker/src/ingest/poller.ts` (lock hooks); env `INSIGHTS_ENABLED` |
| CLIs | `apps/worker/src/cli/insights-status.ts`, `insights-refresh.ts` |
| Shaping and gating | `apps/web/src/server/insights.ts`; page helper `apps/web/src/server/insights-page.ts` |
| API routes | `apps/web/src/app/api/v1/insights/route.ts`, `[subreddit]/route.ts`; error `INSIGHTS_LOCKED` in `server/errors.ts` and `lib/api-errors.ts` |
| Pages | `apps/web/src/app/(app)/insights/` (`page.tsx`, `[subreddit]/page.tsx`, `loading.tsx`, `error.tsx`) |
| Components | `apps/web/src/components/insights/` (`insight-list`, `insight-sections`, `hours-chart`, `browse-list`, `insights-tabs`, `insights-states`) |
| View logic (formatting, facts, states) | `apps/web/src/lib/insights-view.ts` |
| Nav and match page | `apps/web/src/components/app/app-nav.ts`, `apps/web/src/proxy.ts` (matcher), `components/feed/match-detail.tsx`, `app/(app)/feed/[matchId]/page.tsx` |
| Tests | `packages/core/src/insights/*.test.ts`, `packages/db/src/insights.test.ts`, `apps/worker/src/insights/refresher.test.ts`, `apps/web/src/app/api/v1/insights/insights.test.ts`, `apps/web/src/lib/insights-view.test.ts` |

## How it connects

- **Ingestion** supplies the posts, the one analysis per post (`job_post_analyses`), `pre_kind`, `first_seen_at` and `duplicate_of` (cross-post dedupe). The refresher runs inside the poller-lock holder.
- **Matching** supplies `matches` (score, withdrawn) for "Yours" and strong fits, and the feed query for the latest matches.
- **UI** shares the app shell, nav and the match page.
- **Onboarding** supplies the profile: time zone, plan, trial end, `onboarded_at`.
- **Payments** (later) will decide `insightsAllowed` for real; today `profiles.plan` is used.

## Decisions

- Shared precomputed table, hourly; only strong fits is per user (above).
- "Your subreddits" are the ones that gave the user a match in the last 30 days. Users are still not connected to subreddits (CLAUDE.md, 2026-10-01).
- Window: 28 days, compared with the 28 before.
- Posted budgets stay in their own currency; never converted.
- Cross-posting insight dropped.
- Trial and paid plans only; an ended trial sees a locked page.
- Raw counts in the table; thresholds applied on read.
- Hours use the zone's current offset. A DST change moves a bar by an hour for a few weeks (accepted).
- No usernames anywhere; repeat clients is a percentage (rule 7).
- No flair, votes, comments or karma (rule 4).

## Review

One fresh review of the branch: **0 high, 3 medium, 7 low**.

| # | Finding | Status |
|---|---|---|
| M1 | History start came from the oldest `posted_at`, so a new install showed fake history | Fixed: `min(first_seen_at)` with an index (`0019`); posts a week scaled by days covered; "Building history" under 7 days |
| M2 | Strong fits ran one query per row on the Yours list | Fixed: grouped query `userFitCountsMany` |
| M3 | Commission-only posts were counted as "don't say" in the paid share | Fixed: `commission` sent and shown separately; "don't say" is unknown pay only |
| L4 | The refresher forgot its last run when the lock moved | Fixed: it remembers `lastRunAt` |
| L5 | Repeat clients counts an author who reposts the same unfilled gig after the dedupe window as a repeat client | **Open** (see gaps) |
| L6 | CLI and worker refresh could run together | Fixed: advisory lock, they skip each other |
| L7 | Remote share hid the posts that don't say | Fixed: shows "don't say" |
| L8 | Match page waited on the insight line | Fixed: loads in parallel |
| L9 | `displayNames` built its filter by hand | Fixed: uses `inArray` |
| L10 | Red-flag rate is dominated by `vague_pay` | **Fixed 2026-10-21** (user decision) |

## Known gaps

- **L10, fixed 2026-10-21:** `vague_pay` ("no pay mentioned", on about 44 % of hiring posts) no longer counts as a red flag, here or anywhere (`WARNING_FLAGS` in `packages/core/src/job-post.ts`). The refresh counts `red_flag_posts` and the top flags from the 4 warning flags only (`adult_content`, `academic_dishonesty` and `unrealistic_pay` were dropped as red flags the same day, 2026-10-21: no longer extracted, old stored values ignored); the analyser still stores `vague_pay`. Rows computed before the change keep the old count until the next hourly refresh, and the reader hides `vague_pay` and the dropped flags from the top flags meanwhile.
- **L5:** an author who reposts the same unfilled gig after the dedupe window counts as a repeat client. Fixing it needs title matching.
- **"Browse all" leaves out** active subreddits that have no insight row (no post in 56 days).
- **DST drift** in the hours chart (the trade-off above).
- **Building history:** for the first 7 days after collection starts, posts a week and trends show "Building history". Repeat clients waits for 28 days of history before the window.
- Migrations `0018` and `0019` are not on the dev db `redlance`; a refresh has only run on the preview db.
- Not built, by design: converted currencies, cross-posting pairs, reply rates per subreddit (needs about 20 replies each), per-client history, adding a subreddit to the catalogue, alerts about insights.

## Deferred minors

- The refresh reads 56 days of posts each hour. That is fine for tens of thousands of rows; if it grows, add an incremental job.
- The summary line on the match page does one extra indexed read per page view; cache it if it shows up in timing.
