# Subreddit insights: build plan

Design: `../design.md`. Branch `feat/insights`, from `feat/ui` once the feed speed work is committed. Each phase is test-first, ends with typecheck + lint + format + its tests green, and is committed on its own with explicit paths (no AI trailers). One fresh review of the whole branch at the end.

Test databases (never the dev db `redlance`, a soak may be running): db `redlance_test_b`, web `redlance_web_test_d` + Redis db 13, worker `redlance_test_d`.

| Phase | What | Files (owner) | Depends on |
|---|---|---|---|
| 0 | Core: types, thresholds, plan check, pure maths | `packages/core/src/insights/*` | — |
| 1 | DB: table, refresh SQL, readers | `packages/db/src/schema.ts`, migration, `packages/db/src/insights.ts` (+ test) | 0 |
| 2 | Worker: hourly job + CLI | `apps/worker/src/insights/*`, `apps/worker/src/index.ts`, `apps/worker/src/cli/*`, `package.json` script | 1 |
| 3 | Web API + server shaping | `apps/web/src/server/insights.ts`, `apps/web/src/app/api/v1/insights/**`, `server/errors.ts`, `lib/api-errors.ts` | 1 |
| 4 | UI | `apps/web/src/app/(app)/insights/**`, `components/insights/*`, nav + tab bar + top bar, match page line, `proxy.ts` | 3 |
| 5 | Docs + review | `docs/insights/conclusion.md`, `docs/README.md`, CLAUDE.md "Where we are" | 4 |

Phases 2 and 3 can run in parallel (different apps, no shared files).

## Phase 0: core (`packages/core/src/insights/`)

- `INSIGHT_MIN_POINTS = 20`, `INSIGHT_WINDOW_DAYS = 28`, `REPEAT_LOOKBACK_DAYS = 180`, `SKILL_MIN_MENTIONS = 3`, `INSIGHT_SUBREDDITS_DAYS = 30`.
- `insightsAllowed(plan, trialEndsAt, now)`: paid always, trial before its end.
- Pure helpers, all unit-tested:
  - `slotsToLocalHours(slots: number[336], timeZone, now)` → 24 local-hour counts (half-hour zones, negative offsets, wrap across the week);
  - `busiestStretch(hours)` → start hour of the busiest 4-hour window (ties: earliest) and weekday vs weekend share from slots;
  - `ratioText` ("1 in 5", "3 per hiring post"), `percentText`;
  - `gate(n, min)` → `{ ok: true } | { ok: false, have, need }`.
- Shared response types for the API (`InsightsListResponse`, `SubredditInsightsResponse`), each insight being `{ status: "ok", … } | { status: "not_enough", have, need } | { status: "building", days }`.

## Phase 1: DB

- Migration via `npm run db:generate` (never hand-written): `subreddit_insights` as in the design, primary key `subreddit`.
- `refreshSubredditInsights(db, now)`: one statement (CTEs) that computes every row and upserts it, deleting rows for subreddits with no posts in 56 days. Rules to test, each with seeded posts:
  - copies count in their own subreddit with the original's analysis;
  - for-hire posts without an analysis count via `pre_kind`;
  - `other` posts count nowhere;
  - budgets: midpoint, single value, zero ignored, grouped by (currency, unit), percentiles correct on a known set;
  - hour slots: a post at Monday 00:10 UTC → slot 0, Sunday 23:50 → 335;
  - repeat authors: earlier hiring post by the same author (any subreddit) within 180 days counts; same-day second post counts; null / `[deleted]` authors excluded; `history_start` = oldest stored post;
  - window edges (28 days, previous 28 days);
  - idempotent: running twice gives the same rows.
- Readers:
  - `insightRows(db, subreddits?)`;
  - `userInsightSubreddits(db, userId, now)` → `[{ subreddit, matches, bestMatches }]` for matches (not withdrawn) in the last 30 days, counting a match in every subreddit its post or a copy was posted in;
  - `userFitCounts(db, userId, subreddit, since)` → Best matches and hiring posts since a date;
  - `latestMatchesIn(db, userId, subreddit, limit)` (reuse the feed's row shape).
- Check the plan with `EXPLAIN` on a seeded db; add an index only if a read can't use `(community, posted_at)` or the matches indexes.

## Phase 2: worker

- `apps/worker/src/insights/refresher.ts`: runs `refreshSubredditInsights` every hour, only in the process that holds the poller lock (follow how upkeep is wired in `ingest/poller.ts`), once at start, logs counts and duration, never throws out of the loop (log + retry next hour).
- CLI: `insights:status` (rows, oldest `computed_at`, top subreddits) and `insights:refresh` (run once). Script names in `apps/worker/package.json`.
- Tests: scheduling with fake timers, error path, lock gating.

## Phase 3: web API

- `GET /api/v1/insights?tab=yours|all` → the list rows (subreddit, posts a week, trend, fits-you share for "yours", main posted budget, red-flag rate), every number gated.
- `GET /api/v1/insights/:subreddit` → all eleven insights for one subreddit + the 5 latest matches from it. Validate the name (`^[a-z0-9_]{2,21}$`, lowercased); unknown → 404.
- Locked: new error `INSIGHTS_LOCKED` (403) with a message in `lib/api-errors.ts`. Not onboarded → 404 `NOT_FOUND` like `/profile`.
- `server/insights.ts` turns rows into responses: thresholds, wording, local hours (profile time zone), skill names from the taxonomy, never usernames.
- Wrapped in `apiRoute()`, default bucket. Tests: gating at 19/20, locked trial, building history, time-zone shift, unknown subreddit, not onboarded.

## Phase 4: UI

- Read `docs/ui/README.md`, the anti-AI-slop skill and (for the hours chart) the dataviz skill first.
- `/insights` (server-rendered first view, like the feed): Yours / Browse all tabs, a filter box on Browse all, dense rows; states locked / building / empty / error; phone layout.
- `/insights/[subreddit]`: sections for the eleven insights, hours bar chart (inline SVG or plain divs, accessible table fallback), latest matches, "Open r/x".
- Match page line (from the shared row; hidden below thresholds).
- Nav: "Insights" (lucide `ChartNoAxesColumn` or similar, 16 px); phone tab bar: Overview, Matches, Tracker, Insights, Profile; Settings in the top bar on phones. `proxy.ts` matcher gets `/insights/:path*`. Set `prefetch` on links deliberately (no layout query should run from viewport prefetch).
- Component tests for formatting and states; then the main session checks it in a browser with real data (preview db) at desktop and phone width.

## Phase 5: docs and review

- `docs/insights/conclusion.md` (what was built, how, where, decisions, gaps), the status table in `docs/README.md`, CLAUDE.md "Where we are".
- One fresh review of the branch (correctness, rule 7/8 compliance, SQL edge cases), fixes, then the user reads the conclusion and this plan folder is deleted.
