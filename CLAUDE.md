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
- `feat/onboarding`: current work, branched from `main`.

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

### Onboarding: spec written, not built

Spec: `docs/superpowers/specs/2026-09-29-onboarding-design.md`, revised 2026-09-29 after checking it against the code. Plan for slice 1 (manual onboarding): `docs/superpowers/plans/2026-09-29-onboarding-slice-1.md`, 13 tasks, waiting for the user's review; slices 2 and 3 get their own plans after slice 1 lands. Key decisions (2026-09-29):
- **Scope:** all freelance job types found on Reddit (development, design, video, writing, …) with one shared skill taxonomy. This replaces "pick one launch niche".
- **Steps:** Import (optional GitHub link; resume upload in slice 2) → Basics → Skills → Rates & filters → Review/Finish. No subreddit or alert steps: Finish auto-connects subreddits from the job types and turns on email alerts; editing subreddits and connecting Telegram come later in the dashboard.
- **Saving:** only on Next (`completed`) or Save draft (`draft`), one `onboarding_steps` row per user per step with a `version` for conflict detection; no autosave. The user lands on the first step that isn't completed.
- **Imports:** resume (PDF/DOCX → text → Gemini → validated suggestions) and GitHub (public API, no LLM). They run in a new `apps/worker` process that takes jobs from a Postgres `import_jobs` table (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`); the browser polls the job every 1.5 s. The resume file is never kept, only its text.
- **IDs:** UUIDv7 for new tables. New packages: `@redlance/core` (taxonomy, step schemas) and `@redlance/llm`.
- **Build order:** manual onboarding → worker + resume import → GitHub import.

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

### Open questions and next steps

1. **Onboarding:** user reviews the spec revisions and the slice 1 plan (taxonomy and subreddit seed list especially) → build slice 1 → plan slices 2 and 3.
2. **Then:** RSS ingestion in the same worker (RSS adapters → `JobPost`), then matching and alerts, then deployment.
3. **Subreddit list:** the seed list of hiring subreddits per job type needs checking against each subreddit's rules.
5. **Deployment spec:** EC2 + CloudFront + WAF with CDK. CloudFront must forward `Origin` and `CloudFront-Viewer-Address`. Run `/api/v1/health?deep=1` after every deploy. Check that Upstash supports `TIME` inside Lua.
6. **Still undecided:**
   - which features go in which plan, and credit amounts;
   - the payment provider;
   - alert channels for US/UK (email + Telegram suggested);
   - the homepage nav still says "Start free" → `/signup`, which no longer matches the plans.

### Working style that worked

- Explain decisions with trade-offs and a recommendation.
- Features go spec → plan → test-first build, with one fresh code review of the whole branch at the end.
- The user is learning system design: explain new components clearly, with code.

