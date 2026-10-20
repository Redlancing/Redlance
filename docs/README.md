# Docs

Start here. `PROJECT.md` is the product spec (the "why"). Each feature has a folder, and **`conclusion.md` in each folder explains what was built, how it works, where the code is and how it connects**. Read the conclusions in the order below.

| # | Feature | Folder | Status (2026-10-17) |
|---|---|---|---|
| 1 | **Foundation**: local Postgres and Redis, API conventions, rate limits, dev login, dashboard shell | `foundation/` | ✅ Built, merged to `main` |
| 2 | **Homepage**: marketing site | `homepage/` | ✅ Built, merged to `main`. Copy is out of date in places (plans, subreddits) |
| 3 | **Onboarding**: profile steps, resume and GitHub import, the worker, the model client | `onboarding/` | ✅ Built on `feat/onboarding` (not merged). Browser click-through and a live resume eval are still to do. Projects & experience extraction is designed (`projects-experience-design.md`) |
| 4 | **Ingestion**: collect Reddit hiring posts by RSS, analyse each with Gemini | `ingestion/` | ✅ Built on `feat/ingestion` (stacked on onboarding, not merged). 24 h soak run and Phase 0.1/0.4 checks still open |
| 5 | **Matching**: score each post 0–100 for each user, with a reason, plus the feed API | `matching/` | ✅ Backend built and verified 2026-10-18 (`matching/conclusion.md`); not run live end to end yet. Feed UI later |
| 6 | **Alerts**: Telegram (email deferred) | `alerts/` | Built 2026-10-20 on feat/alerts, reviewed and fixed; not run live yet: `alerts/conclusion.md`, design in `alerts/README.md`, build plan in `alerts/plan/`, build notes in `alerts/build-notes.md` |
| 7 | **Drafts**: comment and first DM in the user's voice | `docs/drafts/` | Backend built (2026-10-20), `conclusion.md`; UI not built |
| 8 | **Tracker and learning**: outcomes, edits feed back, follow-ups | `docs/drafts/` | Backend built with drafts (2026-10-20); follow-ups and reminders wait for email |
| 9 | **Deployment**: AWS (EC2, CloudFront, WAF) with CDK | `deployment/` | Not started. `cdn-waf-design.md` is an early, partly outdated draft |
| — | Cognito login, payments, SEO pages | — | Not started |

Where this sits in the roadmap (`CLAUDE.md`): Collect and Understand are done, which is the bottom half of the Phase 1 web MVP. Match, Alert and Draft are the rest of the MVP.

## Files in each folder

| Folder | Files |
|---|---|
| `foundation/` | `conclusion.md` |
| `homepage/` | `conclusion.md`; `attio-teardown.md`, the measured study of attio.com the page copies (layout, motion values) |
| `onboarding/` | `conclusion.md`; `design.md`, the original spec (reasons, security and privacy rules; where it differs from the code, the conclusion says so) |
| `ingestion/` | `conclusion.md`; `plan.md`, the phased plan with Phase 0 answers and build status (code comments point to it); `research/`, the subreddit study and `data/catalogue.json`, the source of `packages/core/src/subreddit-catalogue.ts` |
| `deployment/` | `cdn-waf-design.md` (not built; see its banner) |

Step-by-step build plans are deleted once a feature is built. Git history keeps them (e.g. `git log --diff-filter=D -- docs/`).

## How the whole system fits together

### The parts

```
                      ┌────────────────────────── apps/web (Next.js) ──────────────────────────┐
  Browser ──────────► │ proxy.ts (has session cookie?)                                          │
                      │ pages: / (homepage) · /login · /onboarding/[step] · /dashboard         │
                      │ API:   /api/v1/*  → apiRoute(): session → origin → input → rate limit   │
                      └──────────────┬───────────────────────────────┬─────────────────────────┘
                                     │ SQL (Drizzle)                 │ 1 command per check (Lua)
                                     ▼                               ▼
                    ┌──────────── Postgres 17 + pgvector ────┐    Redis (Valkey locally, Upstash later)
                    │ users · onboarding_steps · profiles …   │    rate-limit buckets, daily quotas
                    │ import_jobs (queue) · llm_usage         │    (only rebuildable data)
                    │ subreddits · feeds · feed_polls         │
                    │ job_posts · job_post_analyses           │
                    └──────────────▲─────────────────────────┘
                                   │ claim jobs (SKIP LOCKED), LISTEN/NOTIFY, write results
                      ┌────────────┴──────────── apps/worker (Node) ──────────────────────────┐
                      │ import runner: resume + GitHub jobs (onboarding)                       │
                      │ poller: Reddit RSS, one request ≥ 65 s apart (ingestion, one per system)│
                      │ analyser: one Gemini call per post (ingestion)                         │
                      │ alerts: router (match_alerts) → sender (alerts) · Telegram bot (1 poller)│
                      └──────────┬───────────────────────┬──────────────────────┬────────────┘
                                 ▼                       ▼                      ▼
                         Vertex AI (Gemini)       www.reddit.com (RSS)     api.github.com
                                                        api.telegram.org (alerts)
```

**Shared packages**, used by both apps:

| Package | Holds |
|---|---|
| `@redlance/core` | Pure code with no I/O: the skill taxonomy, step schemas, the suggestions shape, the `JobPost` shape, the subreddit catalogue, title-tag rules |
| `@redlance/db` | Drizzle schema, migrations, the queue functions, the ingestion storage functions |
| `@redlance/llm` | The Gemini client: Vertex only, structured output, retries, cost |

### Rules every part follows

- **The web app never does slow work.** It adds a row (`import_jobs`), or the worker finds the work itself (Reddit). The worker does the slow, risky or paid parts.
- **Postgres is the queue.** A job is a row. The worker takes it with `FOR UPDATE SKIP LOCKED`, gets woken by `LISTEN/NOTIFY` and also polls in case a notification is missed. Writes are fenced to the claim that owns the job. There is no SQS.
- **Every input is checked twice.** zod in the browser for quick feedback, then zod on the server, which is the one that counts. The schemas live in `@redlance/core`, so the two are identical.
- **AI output is never trusted as-is.** Every model answer must match a schema. Then facts are checked against the source text: evidence quotes for resumes, verbatim budget quotes for posts, and skills limited to a shortlist. Every call's cost goes to `llm_usage`.
- **Protect shared resources.** Per-user rate limits and daily quotas in Redis. One Reddit poller system-wide, with a spacing governor. A daily model budget for post analysis.

### One user's journey (what exists today, and what comes next)

1. **Visits `/`** (homepage). Static, no data.
2. **Signs in** at `/login`. In dev any email works and a signed cookie is set. Cognito replaces this later.
3. **Onboarding:** an optional resume or GitHub import pre-fills Basics and Skills. They set rates, then click Finish. This creates `profiles` and `profile_skills` and starts the 5-day trial.
4. **Meanwhile, all the time:** the worker polls about 238 hiring subreddits. Every post goes into `job_posts`, and each non-[For Hire] post gets a `job_post_analyses` row: kind, pay, job types, skill ids, budget, remote, deadline, red flags, summary.
5. **Matching (backend built):** cross-posts are deduped when stored. Each analysed post is rule-scored 0–100 against every user whose job types or skills fit (posts with no skills go to everyone with the job type as a broad match, never to AI), and a `matches` row is written. Strong matches (score ≥ 50) get an AI re-score with a one-line reason, within the plan's daily cap (15, or 50 on Max). `GET /api/v1/feed` lists them; see `matching/conclusion.md`.
6. **Then:** alert (Telegram) → draft (comment + first DM) → **the user sends it themselves** (never auto-post) → they mark the outcome → their edits teach the voice.

## Adding a feature

1. Create `docs/<feature>/design.md` (or `plan.md`), plus `research/` if needed.
2. Build it test-first.
3. When it's built, write `conclusion.md`, add a row to the table above, and delete the step-by-step plan.
