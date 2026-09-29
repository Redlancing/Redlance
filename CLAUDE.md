# Redlance

Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

Status: pre-MVP — homepage built; local backend foundation, login page and a basic dashboard built (see "Where we are" at the end). The full spec is in `docs/PROJECT.md` (transcribed from `Redlance_Project_Description.pdf`); read the relevant section before designing a feature, schema, or page.

## Repo layout and commands

npm workspaces monorepo (Node ≥ 20.9). Run everything from the repo root.

- `apps/web` — Next.js 16 (App Router, `src/`, TypeScript, Tailwind v4, React Compiler, shadcn/ui on Base UI). Next 16 differs from older versions: read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code.
- `packages/db` — `@redlance/db`: Drizzle schema, client and migrations (Postgres 17 + pgvector). Change the schema only via `npm run db:generate` + committed migrations.
- Server-only code lives in `apps/web/src/server/`. Every API route is under `/api/v1` and wraps its handler in `apiRoute()` (session → origin → input → Redis rate limit). Settings come from env vars validated in `src/server/env.ts`; copy `apps/web/.env.example` to `.env.local`.
- `brand/` — logo files and brand guide (`brand/README.md`). Brand colours are theme tokens in `apps/web/src/app/globals.css` (`flare-50…700`, `cream`, `ink`, `stone`, `bone`, `feed`, `danger`, `success`; shadcn's `primary` = `ink`, so buttons are near-black like Attio's). Fonts: `font-sans`/`font-heading` = Inter, `font-serif` = Fraunces (quotes only), `font-wordmark` = Bricolage Grotesque (logo only). The homepage follows the Attio teardown in `docs/research/attio-teardown.md`; the logo component is `apps/web/src/components/brand/logo.tsx`.
- Verbatim copy (one-liner, core promise) lives in `apps/web/src/lib/site.ts` — import it, don't retype it.
- Coming with onboarding: `apps/worker` (background jobs: imports now, RSS ingestion next), `packages/core`, `packages/llm`. Later: shared `JobPost` types.

Commands: `npm run dev` (starts Docker db + cache, then Next) · `npm test` · `npm run db:up|db:down|db:migrate|db:generate|db:reset` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run format`. Add shadcn components with `npx shadcn@latest add <name> -c apps/web`.

## Core loop

Collect (RSS poll every 2–3 min) → Understand (LLM extracts skills, budget, paid/unpaid, remote, deadline) → Match (0–100 score + one-line reason) → Alert (Telegram) → Draft (comment + DM, in the user's voice) → **human sends** → Learn (edits and outcomes feed back).

## Planned stack

- **Web:** Next.js (React Native/Expo later)
- **Cloud:** all AWS (decided 2026-09-26; replaces the Supabase plan), region us-east-1, infrastructure as code with AWS CDK (TypeScript) in `infra/`.
- **Request path:** CloudFront (CDN) → WAF (managed rules + per-IP rate limit) → one EC2 server running the app in Docker (decided 2026-09-26 after the AWS Free Tier credits were lost). Add an ALB + ECS Fargate when a second server is needed; the app stays stateless so that's an infrastructure change only. Per-user rate limits run in the app against Redis. No AWS API Gateway until there are several backend services or a public API; routes live under `/api/v1`.
- **Data:** Postgres 17 + pgvector runs as a Docker container, on the laptop and on the EC2 server (no RDS, to save cost), with a tested daily backup to S3. Redis: a Valkey 8 container locally, **Upstash** in production (no ElastiCache); only `REDIS_URL` differs, and Redis only holds rebuildable data. Frequent health checks must not touch Redis (Upstash bills per command). Redis is used from day one for per-user rate limits (token bucket), daily quotas and hot caches; S3 for static assets (and uploads if we ever keep files). **No SQS** (decided 2026-09-29): slow jobs go into a Postgres job table, and the worker picks them up. Add SQS only when there are several servers or far more jobs than Postgres can hand out.
- **Auth:** Cognito (Essentials) with Google + email one-time code, no passwords. Tokens in httpOnly cookies, verified in the app on every request; our `users` table is keyed by the Cognito `sub`.
- **Workflow:** build and test each feature locally first (Docker: Postgres + Valkey; a dev Cognito pool), then deploy. Specs live in `docs/superpowers/specs/`.
- **Worker:** one Node process (`apps/worker`), run as a second Docker container on the same EC2 server as the web app; no separate AWS service for it. It runs RSS ingestion every 2–3 min and the background jobs from the Postgres job table. Web code starts work by adding a job row (or calling an API), not through SQS.
- **AI:** Gemini, tiered by task: Flash-Lite for high-volume work (per-post extraction, scoring), Flash for drafts and onboarding imports. Calls go through our own interface so any task can switch model.
- **Matching:** embeddings shortlist + rule filters, then LLM re-score with reasons
- **Alerts:** Telegram Bot API (email/push later)
- **Payments:** subscriptions for US, UK and India customers; provider not chosen yet (Razorpay alone doesn't cover US/UK well)

Core tables: `profiles`, `job_posts`, `matches`, `replies`, `outcomes`, `client_reports` — fields in `docs/PROJECT.md` §8.

## Product decisions (2026-09-25)

- **Subreddits:** there is no subreddit step in onboarding. When onboarding finishes, Redlance connects the user to the right subreddits for their job types; users can add more later from the dashboard but don't have to pick any. Their posts arrive through normal ingestion (the worker, or an API call); nothing extra is queued per user. If the dashboard's subreddits page opens before that data has arrived, it shows a loader. Keep it simple.
- **Trial:** the 5-day trial starts when onboarding finishes, not at sign-up.
- **Portfolio:** no portfolio step (decided 2026-09-29). Onboarding asks for an optional GitHub link instead (optional for everyone, on the Import step).
- **Voice:** no voice step at onboarding. Drafts start in a default short, plain style, and the user's voice is learned from their edits (store every AI draft and sent version from the first draft).
- **Drafts:** a comment and the **first DM** only. Don't market DM conversation handling, and don't state that we don't handle DMs.
- **Follow-ups (paid plans):** if a reply has no status marked after a few days, remind the user and draft a follow-up.
- **Subreddit insights (paid plans):** per subreddit, hiring posts per week, share matching the user's skills, posted-budget ranges and peak posting hours (in the user's time zone). Only from RSS-available fields; shown once a subreddit has enough posts (see rule 8).

## Non-negotiable rules

1. **Never auto-post.** No auto-posting, bulk DMs, or anything that sends from a user's Reddit account without them clicking send. The UI offers an edit box + "Open post" button; the user sends.
2. **Source adapters.** Every data source (RSS now, Reddit API / HN / job boards later) goes through an adapter that emits one common `JobPost` shape. Matching, drafting and alerts must never depend on where a post came from.
3. **Store everything from day one.** Every post, its extracted fields, the author username, and every reported outcome. V2 features (rate insights, client memory, analytics) depend on this history.
4. **RSS limits.** Only title, body, author, link, timestamp are available — no comment counts or author reputation. Don't build features that need those until the licensed-API phase. Poll politely with a clear User-Agent; dedupe (each feed returns only ~25 latest posts).
5. **Keep [Hiring], drop [For Hire].**
6. **Drafts must sound human:** short, reference the client's specific problem, and link the user's work when they have some to show (their GitHub, or the most relevant repo; there is no portfolio step, decided 2026-09-29).
7. **Client reports:** show counts, never labels like "scammer"; require several independent reports; reports expire; scope to hiring behaviour on job posts only.
8. **Insights need data:** don't surface analytics insights under ~20 data points; call budget data "posted budgets", not "market rate".

## Brand, copy and marketing site

- **Domain:** `redlance.app`, registered at Name.com on 2026-09-26 (first year free via the GitHub Student Pack; renews at about ₹2,269/year). DNS is served by Route 53; don't edit DNS at Name.com. USPTO and UK IPO checks for "Redlance" are still pending (a US firm, Redlance Computer Consulting, owns redlance.com).
- **Trademark:** never put "Reddit" in the product name, domain or logo, and never use Reddit's alien mascot. Use "Reddit" only descriptively in body text ("find freelance jobs on Reddit") and never imply an official connection.
- **One-liner, word for word everywhere** (homepage, meta description, social bios): "Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice."
- **Core promise:** "See the right Reddit gigs first, and reply in under two minutes with a message that sounds like you."
- **SEO: pages rank, not names.** One page per target search — `/reddit-freelance-jobs`, `/reddit-web-developer-gigs`, `/reddit-video-editing-jobs`, `/best-subreddits-for-freelancers` — plus guides, comparison pages ("Redlance vs Upwork"), and a public feed of latest hiring posts (short snippet + link back only).
- **AEO:** question headings followed by a 40–60 word direct answer, then detail; FAQ and HowTo structured data.
- Markets: US and UK first, India second. Audience: early-career freelancers, then niche specialists.

## Plans

Decided 2026-09-25; replaces the Free/Pro plans in `docs/PROJECT.md` §9.

- **No free tier.** A 5-day trial, then three paid plans: a standard plan, Max, and Agency.
- Features are split across the plans (which feature goes in which plan is still open).
- Drafts (comment + first DM) and follow-ups are limited by **credits** per plan, not unlimited.
- Agency: multiple profiles, gig routing, team analytics.

## Roadmap

Phase 0 (wks 1–2): Telegram bot, one niche, 10–15 subreddits → Phase 1 (wks 3–8): web app MVP (profile, scoring, drafts, red flags, tracker) → Phase 2 (months 3–4): paid plans with credits, follow-ups, voice learning → Phase 3 (months 4–8): rate insights, client memory, analytics, more sources, licensed Reddit API.

North-star metric: gigs won per active user per month.

## Where we are (2026-09-29)

Handover for the next chat. Update this section as things change.

### Branches

- `main`: homepage + local backend foundation, merged through PR #1 on 2026-09-28 (105 tests passing).
- `feat/homepage`: kept on purpose (the user asked not to delete it); its work is already in `main`.
- `feat/onboarding`: onboarding slice 1 built and reviewed (not merged or pushed yet). 194 tests passing (web 148, core 31, db 15).

### Built so far (in `main`)

- **Local stack:** Postgres (`db`) and Valkey (`cache`) are two Docker containers bound to 127.0.0.1. Next.js runs on the host (`npm run dev`). Tests use the `redlance_test` database and Redis db 15.
- **`packages/db`:** the `users` table (unique `auth_sub` and `email_normalized`, CHECK constraint on `status`); migrations `0000_enable_vector` and `0001_init`.
- **`apps/web/src/server/`:**
  - `env.ts`: zod-validated settings; the server crashes at startup (`instrumentation.ts`) if any are missing or invalid.
  - `errors.ts`: one error shape, `{ error: { code, message, requestId, details? } }`.
  - `logger.ts`: pino JSON logs, one line per request with its request ID.
  - `http.ts`: `clientIp` prefers `CloudFront-Viewer-Address`, otherwise the **last** `X-Forwarded-For` entry.
  - `db.ts`: one pool per process, kept on `globalThis`; the pool has an `error` handler.
  - `redis.ts`: ioredis with RESP2, offline queue off, 1 s command timeout, explicit `retryDelay` backoff with jitter, stops retrying on WRONGPASS/NOAUTH, one warning per outage, and `awaitFirstConnection()` for any client. Lint forbids `new Redis()` outside this file.
- **Rate limits** (`server/rate-limit`, Lua, 1 Redis command each, keys `rl:{u:<id>}:<bucket>` and `q:{u:<id>}:<name>:<yyyymmdd>`):
  - `api` bucket: 30 burst, 2/s, per user (per IP when signed out).
  - `health` bucket: 10 burst, one every 5 s.
  - The bucket **fails open** when Redis is down. Daily quotas (`consumeQuota`) **fail closed** with 503. Quotas are built but not yet used by any feature.
- **Auth (dev stand-in until Cognito):**
  - `AUTH_MODE=dev` is only allowed when `APP_ENV=local` **and** `APP_ORIGIN` is localhost.
  - The session is an HMAC-signed httpOnly cookie `rl_dev_session`. `getSession(request)` serves API routes and `getCurrentUser()` serves pages; both go through `getSessionFromToken()`, which is what Cognito will replace.
  - Sign-in is an `ON CONFLICT` upsert on `auth_sub`.
- **API** (`/api/v1`, every route wrapped in `apiRoute()`: session → origin check on mutations → zod input → rate limit):
  - `/health` is liveness only and never touches Postgres or Redis. `/health?deep=1` checks both.
  - `/me` returns the signed-in user.
  - `/dev/session` POST signs in and DELETE signs out; it returns 404 unless `AUTH_MODE=dev`.
- **UI:**
  - `/login`: Google button disabled in dev, then email.
  - `/dashboard`: sidebar with Overview plus "Soon" items, a "Set up your profile" card, zero-state stats, and an empty matches state.
  - `src/proxy.ts` sends visitors without a session cookie from `/dashboard` to `/login?next=…`; the `(app)/layout.tsx` verifies the session.
  - `safeNextPath()` only allows same-site paths and validates the normalised result.
- **Deferred minors** (from the code review):
  - The rate limit runs after the session, origin and input checks.
  - `x-request-id` from the client is not validated.
  - A database outage during the session lookup returns 500 instead of 503, and errors can log email addresses.
  - `AUTH_MODE=cognito` throws in `getSession` until the login spec lands.
  - `refillPerSec: 0` isn't guarded.
  - The layout redirect hardcodes `next=/dashboard`.
  - The sign-in upsert conflicts only on `auth_sub`; revisit before Cognito.

### Specs and plans (`docs/superpowers/`)

- `specs/2026-09-26-local-dev-foundation-design.md` and `plans/2026-09-26-local-dev-foundation.md`: done.
- `specs/2026-09-26-cdn-waf-foundation-design.md` (Phases 0–2: CDK, Route 53, ACM, CloudFront, WAF): **partly outdated.** The static-export-to-S3 idea is replaced: CloudFront's origin is the EC2 server, with static assets still cached at the edge. It uses the CloudFront flat-rate **Free plan** (includes WAF + Route 53, 1M requests, 100 GB and 5 WAF rules a month; no VPC origins, so the server is locked to CloudFront by security group + secret header). The user hasn't explicitly confirmed the flat-rate plan.

### Onboarding: slice 1 built on `feat/onboarding`

Spec: `docs/superpowers/specs/2026-09-29-onboarding-design.md`. Plan: `docs/superpowers/plans/2026-09-29-onboarding-slice-1.md` (13 tasks, built 2026-09-29 with subagent-driven development: one implementer and one review per task, then a whole-branch review).

What slice 1 added:
- **`packages/core` (`@redlance/core`, pure, zod + uuid only):** 12 job types and about 180 skills (`taxonomy.ts`; skills are retired, never deleted), a 16-subreddit seed list (unverified, `subreddits.ts`), ISO country codes and default currency, the per-step draft/complete schemas and `resumeAt()` (`onboarding.ts`), `parseGithubUsername`, `newId()` (UUIDv7).
- **`packages/db`:** migration `0002_onboarding` adds `skills`, `subreddits`, `onboarding_steps`, `profiles` (with `github_username`), `profile_skills`, `custom_skills`, `user_subreddits`, `alert_channels`. `npm run db:migrate` runs `prepareDatabase()`: migrations, then `syncReferenceData()` copies the taxonomy and subreddits in (upsert, never deletes, advisory lock).
- **Server:** `apiRoute()` takes a `params` zod schema (mismatch → 404) and caps JSON bodies at 256 KB (413). `server/onboarding/service.ts` is the only writer: `saveStep` (one transaction with the user row `FOR SHARE`; step order, no completed→draft, optimistic `version`), `finishOnboarding` (user row `FOR UPDATE`, re-validates every step, writes the profile and child tables, auto-connects subreddits, adds the email alert channel, starts the 5-day trial once). New error codes: `VERSION_CONFLICT`, `STEP_ORDER`, `ALREADY_ONBOARDED`, `PAYLOAD_TOO_LARGE`.
- **API:** `GET /api/v1/onboarding`, `PUT /api/v1/onboarding/steps/:step`, `POST /api/v1/onboarding/finish`.
- **Pages:** `(onboarding)` route group with its own layout; `/onboarding` → the first unfinished step; `/onboarding/[step]` = Import (optional GitHub link; resume "coming soon") → Basics → Skills → Rates & filters → Review. Forms share `useStepForm` (Next / Save draft / Save changes, version conflicts, beforeunload, a localStorage safety net with a restore banner). Dashboard card says "Start setup" / "Continue setup · step N of 5", then shows trial days left.
- **Not checked in a real browser yet:** click-through checks were done with curl only.
- **Deferred minors (from the per-task and final reviews; none block merge):**
  - UX: Enter doesn't submit a step (no `<form>`); editing from Review goes Next → following step, not back to Review; progress bars show position, not completion; client navigation (progress links, logo) skips the leave dialog (the local copy still saves edits); focus is lost when the skills list fills or a chip is removed; disabled job-type chips drop out of the tab order; no message when a blocked word is refused; Enter during IME composition commits a tag; the country code shows for a moment before its name.
  - Form hook: `pending` resets before navigation (a fast double click sends a second save); Back isn't disabled mid-save; STEP_ORDER/ALREADY_ONBOARDED only refresh, no notice; hook save/conflict logic has no tests.
  - A11y: progress rows ~22px tall on mobile; no "(completed)" text for screen readers; add `role="list"` for Safari; some hints aren't linked by `aria-describedby`.
  - Server: a client abort mid-body logs a 500; `getOnboardingState` runs two queries with `Promise.all` on one transaction client (breaks under pg@9); the rate limit runs after reading up to 256 KB; the API accepts retired skill ids; Finish re-validation of bad saved data isn't tested; the finish-vs-save race test is timing-based.
  - Data: taxonomy `group()` can't mark a skill `retired` yet (fix before retiring one); 1–2 letter aliases (c, r, ps, pm…) are risky for free-text matching in slice 2; `parseGithubUsername` accepts `github.com/orgs|settings`; "GMT"/"EST5EDT" time zones are refused; no db CHECKs on profile country / GitHub / lengths (app-validated only); `sqlList` uses `sql.raw` (trusted constants only).
  - Tests: countries test only checks count; the "edit" ranking test depends on taxonomy order; some core helpers untested.

Key decisions (2026-09-29):
- **Scope:** all freelance job types found on Reddit (development, design, video, writing, …) with one shared skill taxonomy. This replaces "pick one launch niche".
- **Steps:** Import (optional GitHub link; resume upload in slice 2) → Basics → Skills → Rates & filters → Review/Finish. No subreddit or alert steps: Finish auto-connects subreddits from the job types and turns on email alerts; editing subreddits and connecting Telegram come later in the dashboard.
- **Saving:** only on Next (`completed`) or Save draft (`draft`), one `onboarding_steps` row per user per step with a `version` for conflict detection; no autosave. The user lands on the first step that isn't completed.
- **Imports:** resume (PDF/DOCX → text → Gemini → validated suggestions) and GitHub (public API, no LLM). They run in a new `apps/worker` process that takes jobs from a Postgres `import_jobs` table (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`); the browser polls the job every 1.5 s. The resume file is never kept, only its text.
- **IDs:** UUIDv7 for new tables. New packages: `@redlance/core` (taxonomy, step schemas) and `@redlance/llm`.
- **Build order:** manual onboarding (done) → worker + resume import (slice 2, plan next) → GitHub import (slice 3).
- **No portfolio step** (user decision): an optional GitHub link on the Import step instead.

### AWS and accounts

- **AWS account "Redlance":** us-east-1, IAM Identity Center (single-region) with an AdministratorAccess permission set, 8-hour sessions.
- **Credits lost:** enabling Identity Center created an AWS Organization, which **expired the Free Tier credits** ($100, plus the $100 still to earn). A support ticket has been sent asking for them back. Also apply for AWS Activate.
- **Nothing deployed yet.** Phases 0–2 would cost about $0 a month on the flat-rate plan.
- **Rule:** check billing and credit side effects before any account-level cloud step.
- **Domain `redlance.app`:** nameservers still at Name.com's defaults; they move to Route 53 when the hosted zone is created.

### Local environment gotchas

- The Docker CLI is in `~/.docker/bin`. If `docker` isn't found, add it to `PATH` or restart the terminal.
- Port 3000 is used by another local app (`node server.js`). Next then falls back to 3001, but the origin check needs `APP_ORIGIN` in `apps/web/.env.local` to match the actual port, or POSTs return 403.
- The laptop runs Node 26; the project pins Node 24 (`.nvmrc`). Install it with `brew install fnm && fnm install 24`.
- npm 11 blocks package install scripts. esbuild still works because its platform binary installs separately.
- Ideas for later: add a per-IP pre-limit before the session lookup; decide whether the quota reset stays at UTC midnight.
- `npm run db:reset` runs `docker compose down -v`, which deletes the local dev database. Use `npm run db:migrate` for normal work.
- Long runs: the laptop dozing made a test run and a build take ~15 min and stalled subagents; run `caffeinate -i` during long agent sessions.
- `main` has 6 files prettier flags (from before onboarding); `npm run format:check` fails on them until someone formats them.

### Open questions and next steps

1. **Onboarding:** click through slice 1 in a browser, merge `feat/onboarding` (user's call), then write the slice 2 plan (worker + resume import), then slice 3 (GitHub import). The user still needs to look over the skill list and subreddit seed list.
2. **Then:** RSS ingestion in the same worker (RSS adapters → `JobPost`), then matching and alerts, then deployment.
3. **Subreddit list:** the seed list of hiring subreddits per job type needs checking against each subreddit's rules.
5. **Deployment spec:** EC2 + CloudFront + WAF with CDK. CloudFront must forward `Origin` and `CloudFront-Viewer-Address`. Run `/api/v1/health?deep=1` after every deploy. Check that Upstash supports `TIME` inside Lua. **Run migrations + `syncReferenceData()` before a new web build takes traffic** (a new skill in code but not yet in the `skills` table makes Finish fail on the `profile_skills` foreign key); `db:migrate` needs `tsx`, so ship a compiled migrate step. WAF: exempt `POST /api/v1/onboarding/imports/resume` from the 8 KB body rule (slice 2).
6. **Still undecided:**
   - which features go in which plan, and credit amounts;
   - the payment provider;
   - alert channels for US/UK (email + Telegram suggested);
   - the homepage nav still says "Start free" → `/signup`, which no longer matches the plans.

### Working style that worked

- Explain decisions with trade-offs and a recommendation.
- Features go spec → plan → test-first build, with one fresh code review of the whole branch at the end.
- The user is learning system design: explain new components clearly, with code.

