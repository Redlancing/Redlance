# Ingestion: collect Reddit hiring posts and understand them. Phased plan

Date: 2026-10-01 · Status: **Phases 1–4 built and committed on `feat/ingestion`** (commit `3f424f9`); Phase 0 items 0.1 and 0.4 still open. See "Build status" at the end for what was built and how it differs from the text below. **For how it works now, read `conclusion.md`** (it is checked against the code and wins where the two differ).

Research behind this plan: `research/subreddits-2026-09-30.md` (223 subreddits checked live in the first pass, 223 more in the second; the decisions are in `research/data/catalogue.json`).

## Goal

Get every hiring post from the subreddits that matter into our database within a few minutes of it being posted, without missing any, without breaking Reddit's rate limit, and with each post's key facts extracted (hiring or for-hire, job type, skills, budget, paid or unpaid, remote, deadline).

**In scope:** Phases 0–4 below: checks, the subreddit catalogue, the collector, the analyser, and running it all day to day.
**Later (outlined at the end, not planned in detail):** matching posts to users, the job feed page, alerts, subreddits added by paying users, and the Reddit API.

## What we know (measured 2026-09-30)

| Fact | Number | Consequence |
|---|---|---|
| Signed-out RSS rate limit | 1 request a minute per IP (fixed windows, `x-ratelimit-*` headers). A request a few seconds after a window reset still got 429 | One global request slot, **at least 65 s apart**, for the whole system |
| Posts per request | 100 at most (`?limit=100`; asking for more returns 100) | A feed must be polled before 100 new posts pile up |
| Combined feeds | `/r/a+b+c/new/.rss?limit=100` works | Many subreddits per request |
| Paging | `&after=t3_<id>` returns the next 100 older posts | Catch up after downtime |
| Site-wide search | `/search.rss?q=title:hiring&sort=new&limit=100` works | Catch-all for subreddits not on our list |
| Volume | About 3,100 posts a day across the ~183 subreddits we'll poll; about 400 a day tagged hiring in the title (more are flair-only) | About 1,330 requests a day × 100 posts is ~40× headroom |
| RSS fields | Title, HTML body, author, subreddit, link, `t3_` id, published/updated time. **No flair, score, comment count or NSFW flag** | Paid/free and client/freelancer flair has to be inferred from text |
| Data-centre IPs | Google Cloud IP: works. **AWS: not tested yet** | Phase 0 check |
| Reddit terms | Commercial use of the Data API needs a separate agreement (Data API Terms, rev. 2026-07-20) | RSS for the MVP, apply for API access in parallel (Phase 0) |

## Decisions in this plan

| Decision | Choice | Why |
|---|---|---|
| Subreddit model | **One central list polled for everyone.** Users are not "connected" to subreddits; the feed filters by what a post asks for, not where it was posted | Polling costs the same for 1 or 10,000 users; general boards (r/forhire, r/B2BForHire) carry every job type |
| Onboarding | **Stop writing automatic `user_subreddits` rows at Finish**; fix the copy that says "Redlance will watch N subreddits for your job types" | Matches the model above |
| Save first, analyse later | Posts go into `job_posts` the moment they are fetched; analysis is a separate step that claims pending posts | RSS forgets (last 100 only), so a failed LLM call must never lose a post; fetching stays fast; posts can be re-analysed when prompts improve; rule 3 (store everything) |
| Queue | **The post row is the work item** (`analysis_status` + `FOR UPDATE SKIP LOCKED`), no separate queue table | Same pattern as `import_jobs`; no extra moving parts |
| Poller | One poller in the whole system, held by a Postgres advisory lock, one request at a time, at least 65 s apart, obeying `x-ratelimit-reset` | The limit is per IP; two pollers would just 429 each other |
| Feeds | Subreddits grouped into a few combined feeds, sized from measured volume, plus site-wide search feeds; rebuilt nightly from our own post counts | Freshness about 5 min with plenty of headroom; adapts as subreddits grow or die |
| Source adapter | `RedditRssSource` emits the common `JobPost` shape (rule 2); `source='reddit'` with `fetched_via='rss'` | The Reddit API later is a second adapter with the same `t3_` ids, so no duplicates and no rewrite |
| For-hire posts | Stored (rule 3), tagged by a free rule-based pre-pass, **not sent to the LLM** | Most posts are for-hire; this halves LLM cost |
| Model | Flash-Lite, one post per call, structured output checked by zod | High volume, simple extraction |

## Phase 0: checks before building (about 1 day, mostly waiting)

Nothing here writes code for the product. Each item can change the design, so do these first.

| # | Check | How | If it fails |
|---|---|---|---|
| 0.1 | **AWS reachability** | Run the test script from `research/subreddits-2026-09-30.md` in **AWS CloudShell** (us-east-1, free) | Poller runs from Google Cloud instead (Cloud Run job or the always-free e2-micro) and writes to our database; nothing else changes |
| 0.2 | **Combined feed limits** | How many subreddits one URL can hold (try 25, 50, 100, 150); what happens when one subreddit in the group is banned, private or misspelled (the whole request fails, or that one is skipped?) | Smaller groups; a banned subreddit gets removed automatically when its group starts failing (Phase 2) |
| 0.3 | **Flair-filtered search** | `/r/PhotoshopRequest/search.rss?q=flair:Paid&restrict_sr=on&sort=new` | Rely on the LLM to infer paid/free from text (already the plan) |
| 0.4 | **Reddit API application** | Apply honestly: read-only tool that finds hiring posts, never posts, DMs or sends anything; ask for commercial pricing | Stay on RSS; revisit with revenue |
| 0.5 | **Your decisions** | The 5 "Your call" subreddits (r/chatterjobs, r/appointmentsetter, r/highticket_sales, r/cofounderhunt, r/FurryCommissions); a contact address for the User-Agent | — |

**Done when:** 0.1 and 0.2 have answers written into this doc.

**Answers (2026-10-01):**
- **0.2:** combined URLs with 40, 80 and 120 subreddits all returned 200 with 100 posts (the 120 URL is 1,730 characters). A group containing a banned subreddit (r/freelance_forhire) also returned 200: Reddit skips the bad one. Groups are now 80 subreddits polled every 5 min. Dead subreddits are caught by the 30-day dormancy rule, and the split logic stays as a safety net.
- **0.3:** `/r/PhotoshopRequest/search.rss?q=flair:Paid&restrict_sr=on&sort=new` works and returns only paid requests. Not used yet (the analyser infers paid vs free); a later option for flair-only boards.
- **0.1 and 0.4:** still open (they need your AWS login and your Reddit application).

## Phase 1: subreddit catalogue (about 1–2 days)

Replace the 16-subreddit seed list with the researched one, stored so that the worker, not code changes, decides what to poll.

**`packages/core/src/subreddits.ts`** becomes the full list from the research report: every polled, excluded, dead and gone subreddit, so we remember why a subreddit isn't polled and don't re-add it by accident.

```ts
export type SubredditTier = "core" | "low" | "regional" | "custom";
export type SubredditStatus = "active" | "excluded" | "dead" | "gone";

export type SeedSubreddit = {
  name: string;               // lowercase, no "r/" — the key
  displayName: string;        // "VideoEditors_forhire"
  categories: readonly CategoryId[]; // [] = general board, matched for every job type
  tier: SubredditTier;
  status: SubredditStatus;
  note?: string;              // hiring convention or reason for exclusion
};
```

**Migration `0005_subreddit_catalogue`** (`subreddits` table):
- Add `display_name`, `tier`, `status` (CHECK lists as today), `note`, `added_by_user_id` (null; for paid custom subreddits later), `created_at`.
- Add stats columns, filled by Phase 4 from our own posts: `posts_per_day`, `hiring_share`, `last_post_at`, `stats_at`.
- Replace `active` with `status` (`active = status = 'active'`).
- `user_subreddits`: delete `source = 'auto'` rows (only local dev data exists) and narrow the CHECK to `'user'`.

**`syncReferenceData()`** upserts the new fields (name, categories, tier, status, note), never deletes, and never overwrites stats columns or custom rows.

**Onboarding changes:**
- `finishOnboarding()` stops inserting `user_subreddits`; `subredditsFor()` is removed.
- Basics hint: "This decides which subreddits Redlance watches for you." → "This decides which jobs we show you."
- Review step: "Redlance will watch N subreddits for your job types: r/…" → "Redlance watches {count} hiring subreddits and shows you the posts that match your skills."

**Tests:** core list sanity (unique lowercase names, valid categories, every excluded/dead row has a note); sync is idempotent and keeps stats; Finish no longer writes `user_subreddits`; copy snapshot.

**Done when:** `npm run db:migrate` loads ~240 catalogue rows, onboarding tests pass, and the review page shows the new copy.

## Phase 2: collector (about 4–5 days)

The poller fetches feeds, turns entries into `JobPost`s and saves them. No LLM.

### New tables (migration `0006_job_posts`)

```ts
// One row per post, forever (rule 3). Raw facts only; analysis lives in job_post_analyses.
job_posts: {
  id: uuid v7 (pk),
  source: "reddit",                 // later: "hn", "remoteok", …
  externalId: text,                 // "t3_1wtumr0"; UNIQUE (source, external_id)
  fetchedVia: "rss" | "api",
  community: text,                  // subreddit, lowercase
  url: text,
  title: text,
  body: text,                       // HTML converted to plain text, capped at 20,000 chars
  author: text | null,              // "name" without "/u/"; null when deleted
  postedAt: timestamptz,
  sourceUpdatedAt: timestamptz | null,
  firstSeenAt: timestamptz default now(),
  firstSeenFeedId: uuid | null,
  preKind: "hiring" | "for_hire" | "unknown",  // free title-tag rule, set on insert
  analysisStatus: "pending" | "running" | "done" | "skipped" | "failed",
  analysisAttempts: int default 0,
  analysisRunAfter: timestamptz default now(),
  analysisLockedAt: timestamptz | null,
}
// indexes: (source, external_id) unique; (analysis_status, analysis_run_after) where pending;
//          (community, posted_at desc); (posted_at desc); (author)

// The polling plan: rebuilt nightly, state survives restarts.
feeds: {
  id: uuid v7, kind: "subreddits" | "search",
  subreddits: text[] | null,        // for kind = subreddits
  query: text | null,               // for kind = search, e.g. "title:hiring"
  weight: int,                      // relative share of request slots
  status: "active" | "retired",
  lastPolledAt, nextPollAt, lastSeenExternalId, consecutiveErrors,
}

// One row per request; operational log, kept 30 days.
feed_polls: {
  id, feedId, startedAt, durationMs, httpStatus, entries, newPosts,
  page: int,                        // 0 = newest; >0 = catch-up page
  rateLimitRemaining, rateLimitReset, errorCode,
}
```

### The poll loop (`apps/worker/src/ingest/poller.ts`)

```
take advisory lock "redlance:reddit-poller" on its own connection (else stay idle, retry each minute)
loop:
  wait until the request slot is free:
      normal: max(65 s after the last request, x-ratelimit-reset + 2 s)
      after 429: reset + 5 s, doubling up to 10 min on repeats
      after 403 / "blocked" page: 30 min, log an error (possible IP block)
  pick the next feed: most overdue by nextPollAt, weighted; every 6th slot goes to a search feed
  fetch → parse Atom → RedditRssSource.toJobPost() → INSERT … ON CONFLICT DO NOTHING RETURNING id
  if all 100 entries were new and the feed had a lastSeenExternalId → gap:
      queue catch-up pages (after=<oldest id>) until an overlap, 5 pages, or posts older than 48 h
  update the feed row, write a feed_polls row, NOTIFY job_posts (wakes the analyser)
```

**Feed planner** (`apps/worker/src/ingest/planner.ts`, a pure function, fully unit-tested): takes active subreddits with their `posts_per_day` and packs them into subreddit feeds so that each feed expects **at most 40 new posts per poll** at the planned interval, capped at the group size found in check 0.2. It adds 2–3 search feeds (`title:hiring`, `title:task`, `title:paid`). With today's numbers that's about 4–6 feeds, each polled every ~5–7 min. New subreddits with no stats start in a small feed of their own until measured.

**Fetching safely** (`apps/worker/src/sources/reddit-rss/client.ts`):
- Only `https://www.reddit.com`; `redirect: "error"`; 30 s timeout; response capped at 3 MB.
- User-Agent `web:app.redlance.ingest:v1 (+https://redlance.app; <contact>)`.
- Atom parsed with `fast-xml-parser` (no DTD or entity expansion).
- Body HTML to text with `html-to-text`. Strip Reddit's "submitted by … [link] [comments]" footer, then `cleanText()` (shared with the resume cleaner: NFKC, invisible characters).

**Pre-pass** (`packages/core/src/post-tags.ts`, pure): title tags to `preKind`: hiring (`[Hiring]`, `[Task]`, `[Paid]`, `[BUYING]`, `PAID -`, `LFC`…), for_hire (`[For Hire]`, `[Hire Me]`, `[Offer]`, `[Selling]`, "commissions open"…), otherwise unknown. For-hire posts get `analysis_status = 'skipped'`.

**Worker wiring:** the poller runs next to the existing import-job runner in the same process (`index.ts` starts both; graceful stop finishes the in-flight request, then exits). New env: `INGEST_ENABLED` (default true locally), `REDDIT_USER_AGENT_CONTACT`. A dev CLI, `npm run ingest:once -w @redlance/worker -- --feed <id>`, polls one feed and prints what was saved.

**Tests:**
- Atom fixtures saved from the 2026-09-30 probes (usernames replaced with fake ones).
- Adapter mapping, footer stripping, and caps.
- Rate governor with a fake clock: 65 s spacing, 429 backoff, reset header.
- Gap detection and catch-up paging.
- Planner packing.
- Dedupe across feeds.
- Advisory lock (a second poller stays idle).
- Nothing in the test suite calls Reddit.

**Done when:** running locally for 24 h collects posts from every active subreddit, `feed_polls` shows no 429 streaks, and a restart after 2 h downtime backfills the gap without duplicates.

## Phase 3: analyser (about 4–5 days)

Turns pending posts into structured facts.

**Table (migration `0007_job_post_analyses`)**, one row per post (the latest analysis):

```ts
job_post_analyses: {
  jobPostId: uuid (pk, fk job_posts),
  pipelineVersion: text,            // bump to re-analyse
  kind: "hiring" | "for_hire" | "other",
  employmentType: "freelance" | "contract" | "part_time" | "full_time" | "unknown",
  payType: "paid" | "commission_only" | "revshare" | "unpaid" | "unknown",
  categories: text[],               // taxonomy category ids
  skillIds: text[],                 // taxonomy skill ids only (validated against the skills table)
  budgetMin, budgetMax: numeric | null, currency: text | null,
  budgetUnit: "fixed" | "hour" | "day" | "week" | "month" | "per_item" | null,
  remote: "remote" | "onsite" | "hybrid" | "unknown", location: text | null,
  deadline: date | null,
  redFlags: text[],                 // e.g. "asks_for_free_test", "off_platform_payment", "vague_pay"
  summary: text,                    // one line, for the feed card
  model: text, createdAt,
}
// llm_usage gets a nullable job_post_id (SET NULL), like import_job_id.
```

**Analyser loop** (`apps/worker/src/ingest/analyser.ts`): the same patterns as the import runner. Claim pending posts with `SKIP LOCKED` (newest first), concurrency 4, fenced writes, 20 s timeout per post, 3 attempts with backoff, a stale sweep, and woken by `NOTIFY job_posts` plus a 10 s poll.

**Pipeline per post:**
1. **Deterministic shortlist:** skill aliases found in title + body (reuse the resume pre-pass matcher). The model picks from this list plus the categories, so it can't invent skill ids.
2. **Flash-Lite call** with structured output → zod check → evidence check (a budget must appear in the text; skills must be in the shortlist).
3. **Save** to `job_post_analyses` and mark the post `done`.

Posts flagged `unknown` by the pre-pass go to the model, which decides hiring vs for-hire. That covers flair-only subreddits like r/PhotoshopRequest.

**Cost guard:** env `ANALYSIS_DAILY_BUDGET_USD` (default 2). When today's `llm_usage` total reaches it, analysis pauses (posts stay pending) and the worker logs a warning. Rough cost, using the unverified Flash-Lite prices in `packages/llm/src/prices.ts`: about 700 input + 250 output tokens per post ≈ $0.0002, times about 1,500 non-for-hire posts a day ≈ **$0.30 a day (~$9 a month)**.

**Eval** (`apps/worker/test/eval/posts/`): about 80 real posts across all 12 job types, labelled by hand. Include tricky ones: flair-only paid requests, RevShare, commission-only closers, full-time roles, gifted UGC. Score each field; the bar before launch is kind ≥ 95%, pay type ≥ 90%, categories ≥ 90%.

**Tests:** zod and evidence checks; skill ids limited to the shortlist; retry and fencing; the budget guard; the deterministic stub LLM (as today), so no test calls Vertex.

**Done when:** 24 h of live posts are all analysed or skipped, the eval passes the bar, and cost per day matches the estimate within 2×.

## Phase 4: running it day to day (about 2 days)

- **Nightly job** (in the worker, under an advisory lock):
  - recompute each subreddit's `posts_per_day`, `hiring_share` and `last_post_at` from `job_posts` (7-day window)
  - mark subreddits with no posts in 30 days as `dead` (re-checked monthly)
  - rebuild `feeds` with the planner
  - delete `feed_polls` older than 30 days
- **Discovery report** (weekly): subreddits that appear in the search feeds but not in our catalogue, ranked by hiring posts. We review them and add the good ones to `subreddits.ts`, so new subreddits get found without another research sprint.
- **Health:**
  - The worker logs an error when there has been no successful poll for 15 min, a 429 streak, 403s, or the analysis backlog is over 500.
  - `npm run ingest:status -w @redlance/worker` prints feeds, the last poll, posts per hour, the backlog and today's LLM cost.
  - Email alerts to us come with the alerts work.
- **Deploy notes** (add to the deployment spec):
  - The worker container needs outbound HTTPS to `www.reddit.com`.
  - Check 0.1 must have passed; if not, use the Google Cloud poller fallback.
  - Run the reachability script once from the EC2 server after the first deploy.

**Done when:** a week of unattended running with no missed hour (checked against `feed_polls`) and an up-to-date catalogue report.

## Later (not planned in detail)

1. **Matching and the job feed:** embeddings plus rule filters, then scoring; feed page; full-time roles hidden by default. Needs its own design doc.
2. **Alerts:** email and Telegram.
3. **Paid-plan custom subreddits:** a user adds a subreddit, we check it with one fetch, and it gets `tier = 'custom'` with `added_by_user_id`. Open question: are its posts shown only to users who follow it, or to everyone?
4. **Megathread comments:** hiring in pinned threads (r/developersIndia, r/graphic_design, r/golang, r/rust, r/sales) needs a comment-feed adapter.
5. **Reddit API adapter:** swap `fetchedVia` to `api` when an agreement exists. It adds flair, NSFW flag, edits and deletions.
6. **Other sources** through the same `JobPost` shape (HN "Who is hiring", job boards).

## Build order and effort

| Phase | Effort | Can start |
|---|---|---|
| 0: checks | ~1 day (mostly waiting on AWS login and Reddit) | Now |
| 1: catalogue | 1–2 days | Now (0.5 decisions can land later) |
| 2: collector | 4–5 days | After 0.2 (group size) |
| 3: analyser | 4–5 days | After Phase 2 saves posts |
| 4: running it | ~2 days | After Phase 3 |

Each phase is built test-first and reviewed before the next starts. `feat/onboarding` should be merged before Phase 1 lands, because Phase 1 changes onboarding code.

## Open questions for review

1. **The 5 "Your call" subreddits:** keep or drop each (r/chatterjobs is adult-industry chat work; r/appointmentsetter and r/highticket_sales are mostly commission-only; r/cofounderhunt is mostly equity-only; r/FurryCommissions is NSFW-heavy).
2. **Regional employment boards** (25 subreddits, ~776 posts a day, mostly full-time local jobs): collect them now and hide full-time roles in the feed later (recommended), or skip them for now?
3. **Contact for the User-Agent:** which email or Reddit username to put in it.
4. **Merge order:** merge `feat/onboarding` into `main` first (recommended), or stack this branch on it?

## Build status (2026-10-01)

Built test-first; 489 tests pass across the workspaces (core 82, db 51, llm 26, worker 104, web 226), typecheck and lint clean. Reviewed by a fresh agent; all important findings fixed. Committed on 2026-10-02 (`3f424f9`). On 2026-10-17, after the worker tests deleted in `5645aeb` were restored, 601 tests pass (web 226, worker 216, core 82, db 51, llm 26).

**Defaults taken for the open questions** (easy to change):
- r/chatterjobs and r/FurryCommissions are **excluded**. r/appointmentsetter, r/highticket_sales and r/cofounderhunt stay; the analyser marks commission-only and equity-only posts.
- The regional job boards are collected; the analyser tags full-time roles.
- The User-Agent is `web:app.redlance.ingest:v1 (+https://redlance.app; <REDDIT_UA_CONTACT>)`, with the contact optional.
- The branch is stacked on `feat/onboarding`.

**What was built, and where it differs from the text above:**
- **Catalogue:**
  - `packages/core/src/subreddit-catalogue.ts` is generated from `research/data/catalogue.json`: 473 rows, 238 of them active (second research pass added 52, see the report).
  - `subreddits` gained `display_name`, `tier`, `status`, `note`, stats columns (seeded from the study's measured volume) and `dormant_since`. `active` was dropped.
  - There's no `added_by_user_id`: a foreign key to `users` made `TRUNCATE users CASCADE` wipe the catalogue, and `user_subreddits` already records who added a subreddit.
  - Finish no longer writes `user_subreddits`, and the onboarding copy is updated.
  - Migrations: `0005_subreddit_catalogue` (hand-edited so it works on existing rows), `0006_drop_subreddit_active`, `0007_ingestion`.
- **Feeds:**
  - Feeds store `interval_seconds`, not a weight. The poller always takes the most overdue feed, so under load every feed slows down equally.
  - Catch-up state (`catch_up_after`, `catch_up_pages_left`) lives on the feed. A gap is detected as a full page with every post new, on a feed that has been polled before.
  - Catch-up pages take every other request slot when any are pending.
- **Planner:**
  - Packs subreddits busiest first into the least-loaded group, at most `INGEST_MAX_GROUP` (80, from check 0.2) per group, with fewer than 40 new posts expected per poll.
  - Groups are polled every 5 min; dormant subreddits in a separate group every 6 h.
  - 3 search feeds (`title:hiring`, `title:task`, `title:paid`) every 20 min.
  - With 238 active subreddits: 3 groups of about 80 every 5 min plus the 3 searches, about 1,080 requests a day of the ~1,330 the spacing allows.
- **Search feeds:**
  - Posts from excluded, dead or gone catalogue subreddits are dropped.
  - Posts from subreddits outside the catalogue are stored, and analysed only when the title says hiring.
  - `uncataloguedCommunities()` feeds the weekly discovery report. It is logged by upkeep and shown in `ingest:status`.
- **Analyser:**
  - Each call's output schema limits `skills` to the post's own shortlist, so Gemini's constrained decoding can't invent ids.
  - A budget is kept only if its quote is verbatim in the post and its numbers appear in the quote.
  - Kind is about role: hiring means someone wants work done, paid or not. Pay type is about money. Scams with no real work count as "other".
  - Provider quota errors are retried, not failed.
- **Eval:** `apps/worker/test/eval/posts/` holds 32 synthetic labelled posts covering all 12 job types and the tricky cases. Run it with `npm run eval:posts -w @redlance/worker`. First live result (2026-10-01): kind 100%, pay type 100%, categories 92%, skills 100%, budget 95%, at **$0.00025 a post** with a p50 of 1.6 s.
- **Operations:**
  - Upkeep runs inside the poller (only the worker holding the poller lock): when it takes the lock, then every 24 h.
  - `npm run ingest:status` and `npm run ingest:plan` (both `-w @redlance/worker`).
  - New env vars: `INGEST_ENABLED`, `ANALYSIS_ENABLED`, `ANALYSIS_DAILY_BUDGET_USD` (2), `INGEST_MAX_GROUP` (80), `INGEST_MIN_SPACING_MS` (65000, also the floor), `REDDIT_UA_CONTACT`.

**Live run (2026-10-01, local, ~25 min, real Reddit and Vertex):**
- 15 requests, all at least 67 s apart, 0 rate-limited, 0 blocked. One network drop was retried after 2× the spacing.
- 580 posts collected; 312 analysed (127 hiring, 119 other, 66 for-hire), the rest skipped as for-hire. The queue drained with 0 failures.
- Model spend was $0.079 (about $0.00025 a post).
- `SIGTERM` stopped the worker cleanly in about 2 s.
- Spot checks of real posts looked right: untagged paid requests counted as hiring, budgets in ₹ and $, commission-only and revshare marked, discussions counted as "other".
- **Fixes from the run:**
  - Search feeds return posts on user profiles (u/name, mostly company ads). They are now skipped and counted separately, not as malformed.
  - Summaries no longer include people's names. That's prompt `post-extract@2` / pipeline `post@2`, and the eval still meets the bar.

**Still open:**
- 0.1 AWS reachability (CloudShell). Google Cloud passed on 2026-09-30.
- 0.4 the Reddit API application.
- A 24-hour soak run (Phase 2 "done when"); the 25-minute live run passed.
