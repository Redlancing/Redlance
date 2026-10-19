# Ingestion (collect and understand Reddit posts): conclusion

**Status (2026-10-17):**
- Phases 1–4 of `plan.md` are built and committed on `feat/ingestion` (commit `3f424f9`). They are not merged to `main`.
- A 25-minute live run against real Reddit and Vertex passed.
- Still open: the 24-hour soak run, Phase 0 checks 0.1 (does Reddit answer from AWS?) and 0.4 (Reddit API application).
- Steps 1–2 of the core loop (Collect → Understand) are done. Step 3 (Match) has its backend built: see [`../matching/conclusion.md`](../matching/conclusion.md). Alert, Draft and Learn are not built.

## In one paragraph

The worker reads Reddit's public RSS feeds for 238 hiring subreddits. Many subreddits go into one request (a "combined feed", `r/a+b+c/new/.rss`), so three requests every 5 minutes cover them all. Requests are always **at least 65 seconds apart**, because signed-out RSS allows about one a minute per IP. Every post is stored once. Posts tagged `[For Hire]` are kept but not analysed. Every other post is sent to Gemini Flash-Lite, which fills in a fixed form: is this someone hiring, is it paid, which job types and skills, budget, remote, deadline, red flags, and a one-line summary. The result lands in `job_post_analyses`, ready for matching. It costs about **$0.00025 a post**.

## The big picture

```
                         apps/worker (one Node process)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  POLLER (only one in the whole system: Postgres advisory lock)            │
 │    upkeep (daily) ─► planner: subreddits → ~3 combined feeds + 3 searches │
 │    loop: governor says "65 s passed?" ─► pick most overdue feed           │
 │          ─► fetch RSS ─► parse Atom ─► adapter → JobPost ─► selectPosts   │
 │          ─► saveJobPosts (dedupe) ─► NOTIFY job_posts                     │
 │                                             │                            │
 │  ANALYSER (4 at a time)  ◄──────────────────┘ (or 10 s poll)             │
 │    claim pending posts ─► skill shortlist ─► Gemini Flash-Lite           │
 │    ─► checks (budget quote, deadline) ─► job_post_analyses + llm_usage   │
 │                                                                          │
 │  IMPORT RUNNER (onboarding: resume / GitHub jobs) — separate, same process│
 └──────────────────────────────────────────────────────────────────────────┘
                 │ reads/writes
                 ▼
 Postgres: subreddits · feeds · feed_polls · job_posts · job_post_analyses · llm_usage
```

## Where the code is

| Part | Files |
|---|---|
| Subreddit catalogue | `packages/core/src/subreddit-catalogue.ts`: generated from `research/data/catalogue.json`, 473 rows (238 active, 87 excluded, 141 dead, 7 gone; tiers core / low / regional). `subreddits.ts` holds the types and `ACTIVE_SUBREDDITS` |
| Shared post shape | `packages/core/src/job-post.ts`: the `JobPost` zod schema and every enum (kinds, pay types, red flags…). **Every source must produce this shape** (rule 2) |
| Title tags | `packages/core/src/post-tags.ts`: `preKindFromTitle()` reads `[Hiring]`, `[Task]`, `[Paid]`… vs `[For Hire]`, `[Offer]`, `[Commissions open]`… without calling the model |
| Tables | Migrations `0005_subreddit_catalogue`, `0006_drop_subreddit_active`, `0007_ingestion`. Schema at `packages/db/src/schema.ts` (from line ~420) |
| DB functions | `packages/db/src/ingest.ts`: save posts, feed scheduling, the analysis queue, upkeep queries |
| Catalogue → DB | `packages/db/src/reference.ts`: `syncReferenceData()` (runs on `npm run db:migrate`) |
| RSS adapter | `apps/worker/src/sources/reddit-rss/`: `feed-url.ts` (builds URLs), `client.ts` (fetch), `parse.ts` (Atom XML), `adapter.ts` (entry → `JobPost`) |
| Collector | `apps/worker/src/ingest/`: `poller.ts` (the loop), `governor.ts` (request spacing and backoff), `planner.ts` (groups subreddits into feeds), `poll-feed.ts` (one poll), `upkeep.ts` (daily jobs) |
| Analyser | `apps/worker/src/ingest/analyser.ts` (queue, concurrency, budget, breaker), `analyse-post.ts` (prompt, schema, checks) |
| Wiring and settings | `apps/worker/src/index.ts`, `apps/worker/src/env.ts`, `apps/worker/.env.example` |
| Scripts | `apps/worker/src/cli/ingest-status.ts`, `ingest-plan.ts`; eval in `apps/worker/test/eval/posts/` |

## The tables

| Table | One row per | Key columns |
|---|---|---|
| `subreddits` | subreddit in the catalogue | `name`, `tier`, `status` (active/excluded/dead/gone), `categories`, `posts_per_day`, `hiring_share`, `last_post_at`, `dormant_since`, `last_polled_at`, `unreachable_since` |
| `feeds` | one URL we poll | `kind` (subreddits/search), `subreddits[]` or `query`, `interval_seconds`, `next_poll_at`, catch-up state (`catch_up_after`, `catch_up_pages_left`, `catch_up_until`), `consecutive_errors`, `status` (active/retired) |
| `feed_polls` | request we made (kept 30 days) | `http_status`, `entries`, `new_posts`, `page`, rate-limit headers, `error_code` |
| `job_posts` | post (unique on `source` + `external_id`, e.g. `reddit` + `t3_abc123`) | title, body, author, community, url, `posted_at`, `pre_kind` (from the title tag), `analysis_status` (pending → running → done / failed, or skipped), `analysis_attempts`, `analysis_error` |
| `job_post_analyses` | analysed post | `kind` (hiring / for_hire / other), `employment_type`, `pay_type`, `categories[]`, `skill_ids[]`, `budget_min/max`, `currency`, `budget_unit`, `remote`, `location`, `deadline`, `red_flags[]`, `summary`, `model`, `pipeline_version` |
| `llm_usage` | model call attempt (shared with onboarding) | task, step, model, tokens, `cost_micros`, latency, outcome, `job_post_id`; never the text |

`job_posts.community` has **no** foreign key to `subreddits`, on purpose: search feeds can find hiring posts in subreddits we don't list yet.

## One post, end to end

1. **Only one poller.** On start, the worker tries to take a Postgres *session advisory lock* (`redlance:reddit-poller`). This is a named lock that lasts as long as one connection. Whoever holds it polls; any other worker checks again every 60 s. If the holder dies, its connection closes, the lock is freed, and another worker takes over. This is how "one poller system-wide" is enforced without extra infrastructure.
2. **Upkeep runs first** (then every 24 h), in `upkeep.ts`:
   1. refresh each subreddit's posts a day and hiring share from the last 7 days;
   2. mark subreddits silent for 30 days as dormant;
   3. **re-plan the feeds**;
   4. requeue failed or outdated analyses;
   5. delete `feed_polls` older than 30 days;
   6. log hiring subreddits we've seen that aren't in the catalogue (discovery).
3. **Planning** (`planner.ts`, pure function):
   - Pack active subreddits into groups of at most 80, busiest first into the emptiest group, so no group expects more than 40 new posts per 5-minute poll (a page holds 100).
   - Dormant subreddits go in groups polled every 6 h. Unreachable ones are polled alone once a day.
   - Add 3 site-wide searches (`title:hiring`, `title:task`, `title:paid`) every 20 min.
   - Today that is about **1,080 requests a day** of the ~1,330 that 65 s spacing allows. If a plan ever needs more, every interval stretches equally.
4. **Waiting for a slot** (`governor.ts`):
   - The governor books the next slot *before* the request goes out, so a crash can't shorten the gap.
   - After a **429**: wait 1 min, doubling up to 10 min.
   - If two *different* feeds are refused (403) in a row, we're probably IP-blocked: wait 30 min, doubling up to 2 h.
   - On network errors: wait 2× the spacing.
   - On restart it reads the last 20 `feed_polls`, so the spacing survives restarts.
5. **Pick a feed:** the most overdue one. Every other slot goes to a "catch-up" page if one is pending (step 9).
6. **Fetch** (`client.ts`): `GET https://www.reddit.com/r/a+b+…/new/.rss?limit=100` with our User-Agent `web:app.redlance.ingest:v1 (+https://redlance.app; <contact>)`. 30 s timeout, 3 MB cap, redirects refused. It never throws: every outcome becomes a code (`RATE_LIMITED`, `BLOCKED`, `TIMEOUT`, …).
7. **Parse and convert:**
   - `parse.ts` reads the Atom XML and refuses `DOCTYPE`/`ENTITY`, which blocks XML bomb tricks.
   - `adapter.ts` keeps only the post body (the part between Reddit's `SC_OFF`/`SC_ON` markers), turns the HTML into plain text, cleans it, caps the length, and validates it as a `JobPost`.
   - Posts on user profiles (`u/…`) are skipped.
8. **Choose and save** (`poll-feed.ts` → `saveJobPosts`):
   - `preKindFromTitle()` tags each post from its title.
   - `[For Hire]` posts are saved as `skipped` (stored, never analysed: rule 5 and rule 3).
   - Posts from our subreddits are saved as `pending`. So are posts from unknown subreddits whose title says hiring.
   - `INSERT … ON CONFLICT DO NOTHING` drops posts we already have, whichever feed found them.
   - If any new pending post was saved, Postgres sends `NOTIFY job_posts`.

   **Cross-posts are deduped here (added with matching).** In the same transaction as the insert, `saveJobPosts` marks a new post as a copy of an earlier one when the same author posted a near-identical post within 72 hours (a strict rule: very similar title and body, the same numbers in the title). A copy keeps `duplicate_of` pointing at the original, is saved as `skipped` with error `DUPLICATE`, and is never analysed or matched. The rule, its settings (`DEDUPE_SIMILARITY`, `DEDUPE_WINDOW_HOURS`) and the reasons it is strict are in [`../matching/conclusion.md`](../matching/conclusion.md).
9. **Gap catch-up:** if a page came back full (≥ 90 posts) and even its oldest post is newer than our last poll, we probably missed some. Up to 5 older pages are fetched with `&after=<oldest id>`, within 48 h.
10. **Record** the poll in `feed_polls` and schedule the feed's next poll. On errors the feed backs off, doubling, up to 1 h. If a group keeps failing with 403/404, it is split in half to find the bad subreddit.
11. **Analyse** (`analyser.ts`):
    - Woken by the `NOTIFY` (or a 10 s timer), it claims up to 4 pending posts, newest first.
    - It uses `FOR UPDATE SKIP LOCKED`, so two analysers never take the same post.
    - It first checks the daily budget (`ANALYSIS_DAILY_BUDGET_USD`, default $2) and a circuit breaker: after 3 provider failures in a row, it pauses 1 min, doubling up to 15 min.
12. **One model call per post** (`analyse-post.ts`):
    1. Find skills mentioned in the post by matching the skill taxonomy's names and aliases. This is the **shortlist** (up to 40).
    2. Build the prompt. The post goes inside `<post>…</post>` and is marked as untrusted text, so instructions inside a post are ignored.
    3. Call Flash-Lite with an output schema where `skills` can **only** be ids from the shortlist. Gemini's constrained decoding then can't invent skills.
    4. Settings: temperature 0, 15 s timeout, one retry.
13. **Check the answer:**
    - A budget is kept only if its quote appears word for word in the post and the numbers appear in the quote. This stops made-up budgets.
    - A deadline must be a real date near the post date.
    - For-hire posts get no budget.
14. **Store:** upsert `job_post_analyses` and set the post to `done`. Every attempt, failed ones too, goes into `llm_usage` with its cost.
    - On failure, the post is retried after 30 s and then 60 s, and marked `failed` after 3 tries.
    - Provider outages don't use up an attempt.
    - A sweep rescues claims stuck for more than 2 minutes, for example after a crash.

**Timing:** a post is stored about 5–6 minutes after it is posted, and analysed about 2 seconds later.

## Decisions worth remembering (and why)

- **Combined feeds** (`r/a+b+c`): one request covers 80 subreddits. Check 0.2 showed 120 work and a banned subreddit in a group is skipped, not fatal.
- **A user isn't connected to subreddits.** Everyone shares one catalogue, and the feed will be filtered by what the post asks for. So onboarding Finish no longer writes `user_subreddits`, and that table is kept for a later paid "add your own subreddit".
- **Feeds store an interval, not a weight.** The poller always takes the most overdue feed, so under load every feed slows down equally.
- **Two queues, same pattern as onboarding:** Postgres rows plus `LISTEN/NOTIFY` plus `SKIP LOCKED`, with no SQS. The analysis queue lives on `job_posts` itself (`analysis_status`).
- **Kind is about role, pay type is about money.** "Hiring" means someone wants work done, paid or not. Unpaid, commission-only and revshare posts are marked in `pay_type`, not dropped.
- **Versioned outputs:** `pipeline_version = post@2`, `prompt_version = post-extract@2`. Upkeep re-analyses recent posts made by an older version. Version 2 removed people's names from summaries.
- **Defaults taken for the plan's open questions:**
  - r/chatterjobs and r/FurryCommissions are excluded.
  - r/appointmentsetter, r/highticket_sales and r/cofounderhunt are kept; commission-only and equity-only posts are marked.
  - Regional job boards are collected, and full-time roles are tagged.

## Settings (`apps/worker/.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `INGEST_ENABLED` | true | Run the poller |
| `ANALYSIS_ENABLED` | true | Run the analyser |
| `ANALYSIS_DAILY_BUDGET_USD` | 2 | Stop claiming once today's (UTC) model spend reaches this |
| `INGEST_MAX_GROUP` | 80 | Subreddits per combined feed (max 120) |
| `INGEST_MIN_SPACING_MS` | 65000 | Gap between Reddit requests (can't go lower) |
| `REDDIT_UA_CONTACT` | — | Contact in the User-Agent; required outside local |
| `VERTEX_MODEL_FAST` | `gemini-3.5-flash-lite` | Model for analysis |
| `WORKER_CONCURRENCY` | 4 | Shared by the analyser and the import runner |

## How to run and check it

```sh
npm run dev                                   # web + worker; the worker starts polling (needs Vertex credentials for analysis)
npm run ingest:status -w @redlance/worker     # feeds, requests in 24 h, posts, analysis backlog, spend today, discovery
npm run ingest:plan -w @redlance/worker       # rebuild the feed plan now
npm run eval:posts -w @redlance/worker        # 32 labelled posts against the real model; passes or fails the bar
```

**Results so far:**
- **Eval** (2026-10-01): kind 100%, pay type 100%, categories 92%, skills 100%, budget 95%, $0.00025 a post, p50 1.6 s.
- **Live run** (2026-10-01, 25 min):
  - 15 requests, all at least 67 s apart, 0 rate-limited;
  - 580 posts stored, 312 analysed, $0.079;
  - clean shutdown in about 2 s.

## Tests

`npm test` never calls Reddit or Vertex: fetch is faked with synthetic Atom feeds (`apps/worker/test/atom.ts`), and the model is stubbed (`test/stub-llm.ts`).

| Test file | Tests |
|---|---|
| `reddit-rss.test.ts` | 18 |
| `collector.test.ts` | 12 |
| `governor-planner.test.ts` | 14 |
| `analyser.test.ts` | 15 |
| `packages/db/src/ingest.test.ts` | 19 |
| `post-tags.test.ts` | 33 cases |
| `apps/worker/src/db.test.ts` (one lock holder) | 2 |

## Not built / known gaps

- **Core loop:** Alert (Telegram/email), Draft, the feed page, and Learn are not built. Matching's backend is built (see `../matching/conclusion.md`).
- **Checks not done:** the 24-hour soak run and a week unattended. Phase 0.1 (AWS reachability) and 0.4 (Reddit API application) are open.
- **Not built from the plan:**
  - `ingest:once`;
  - a warning when the analysis backlog passes 500;
  - email health alerts. Only log lines exist: "no successful poll in 15 min" and "possible IP block".
- **`dead` is never set automatically.** `dormant_since` is used instead, and dormant subreddits are still polled every 6 h.
- **The catalogue generator isn't in the repo** (it was a scratch script). To change the catalogue, edit `research/data/catalogue.json` and `subreddit-catalogue.ts` by hand, keeping them identical, or rewrite the generator.
- **Prices are unverified.** The Flash-Lite model id and prices in `packages/llm/src/prices.ts` are placeholders. The budget guard and every cost figure depend on them, so confirm them on Google's pricing page.
- **Timeout mismatch.** The per-post timeout (20 s) is shorter than two 15 s model attempts, so a slow first attempt can leave no time for the retry.
- **On by default everywhere.** `INGEST_ENABLED` and `ANALYSIS_ENABLED` default to true in every environment.
- **Missing database guards:**
  - no index on `llm_usage.job_post_id`;
  - `skill_ids` and `red_flags` aren't checked by the database, only by app code.
- **Deployment:** the worker container also needs outbound HTTPS to `www.reddit.com`. `CLAUDE.md`'s container note lists only Postgres, Vertex and GitHub.

## Research

`research/subreddits-2026-09-30.md` is the study behind the catalogue.
- **First pass:** 223 candidate subreddits checked live, totalling about 3,100 posts a day, about 400 of them tagged hiring.
- **Second pass** (2026-10-01): another 223 checked; 52 added, most of them long tail.

`research/data/catalogue.json` is the source of `subreddit-catalogue.ts`.

The user still needs to review the list. Upkeep's discovery log suggests subreddits to add.
