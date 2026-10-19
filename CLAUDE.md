# Redlance

Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

Status: pre-MVP — homepage, local backend foundation, onboarding, ingestion (collect + understand posts) and the matching + feed backend built; the feed UI, alerts and drafts are next (see "Where we are" at the end and `docs/README.md`). The full spec is in `docs/PROJECT.md` (transcribed from `Redlance_Project_Description.pdf`); read the relevant section before designing a feature, schema, or page.

## Repo layout and commands

npm workspaces monorepo (Node ≥ 20.9). Run everything from the repo root.

- `apps/web` — Next.js 16 (App Router, `src/`, TypeScript, Tailwind v4, React Compiler, shadcn/ui on Base UI). Next 16 differs from older versions: read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code.
- `packages/db` — `@redlance/db`: Drizzle schema, client and migrations (Postgres 17 + pgvector). Change the schema only via `npm run db:generate` + committed migrations.
- Server-only code lives in `apps/web/src/server/`. Every API route is under `/api/v1` and wraps its handler in `apiRoute()` (session → origin → input → Redis rate limit). Settings come from env vars validated in `src/server/env.ts`; copy `apps/web/.env.example` to `.env.local`.
- `brand/` — logo files and brand guide (`brand/README.md`). Brand colours are theme tokens in `apps/web/src/app/globals.css` (`flare-50…700`, `cream`, `ink`, `stone`, `bone`, `feed`, `danger`, `success`; shadcn's `primary` = `ink`, so buttons are near-black like Attio's). Fonts: `font-sans`/`font-heading` = Inter, `font-serif` = Fraunces (quotes only), `font-wordmark` = Bricolage Grotesque (logo only). The homepage follows the Attio teardown in `docs/homepage/attio-teardown.md`; the logo component is `apps/web/src/components/brand/logo.tsx`.
- Verbatim copy (one-liner, core promise) lives in `apps/web/src/lib/site.ts` — import it, don't retype it.
- `apps/worker` — `@redlance/worker`: one Node process for background jobs (resume and GitHub imports; Reddit ingestion in `src/ingest/` and `src/sources/reddit-rss/`); copy `apps/worker/.env.example` to `.env.local`. `packages/core` — `@redlance/core` (pure: taxonomy, step schemas, suggestions, the shared `JobPost` shape, the subreddit catalogue). `packages/llm` — `@redlance/llm` (Gemini on Vertex AI).

Commands: `npm run dev` (starts Docker db + cache, then Next and the worker together) · `npm test` · `npm run db:up|db:down|db:migrate|db:generate|db:reset` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run format`. Add shadcn components with `npx shadcn@latest add <name> -c apps/web`.

## Core loop

Collect (RSS: every hiring subreddit about every 5 min, in combined feeds of ~80) → Understand (LLM extracts skills, budget, paid/unpaid, remote, deadline) → Match (0–100 score + one-line reason) → Alert (Telegram) → Draft (comment + DM, in the user's voice) → **human sends** → Learn (edits and outcomes feed back).

## Planned stack

- **Web:** Next.js (React Native/Expo later)
- **Cloud:** all AWS (decided 2026-09-26; replaces the Supabase plan), region us-east-1, infrastructure as code with AWS CDK (TypeScript) in `infra/`.
- **Request path:** CloudFront (CDN) → WAF (managed rules + per-IP rate limit) → one EC2 server running the app in Docker (decided 2026-09-26 after the AWS Free Tier credits were lost). Add an ALB + ECS Fargate when a second server is needed; the app stays stateless so that's an infrastructure change only. Per-user rate limits run in the app against Redis. No AWS API Gateway until there are several backend services or a public API; routes live under `/api/v1`.
- **Data:** Postgres 17 + pgvector runs as a Docker container, on the laptop and on the EC2 server (no RDS, to save cost), with a tested daily backup to S3. Redis: a Valkey 8 container locally, **Upstash** in production (no ElastiCache); only `REDIS_URL` differs, and Redis only holds rebuildable data. Frequent health checks must not touch Redis (Upstash bills per command). Redis is used from day one for per-user rate limits (token bucket), daily quotas and hot caches; S3 for static assets (and uploads if we ever keep files). **No SQS** (decided 2026-09-29): slow jobs go into a Postgres job table, and the worker picks them up. Add SQS only when there are several servers or far more jobs than Postgres can hand out.
- **Auth:** Cognito (Essentials) with Google + email one-time code, no passwords. Tokens in httpOnly cookies, verified in the app on every request; our `users` table is keyed by the Cognito `sub`.
- **Workflow:** build and test each feature locally first (Docker: Postgres + Valkey; a dev Cognito pool), then deploy. Docs are grouped by feature: `docs/<feature>/` holds its `conclusion.md` (how the built feature works), its design and research (index and status: `docs/README.md`). Step-by-step plans are deleted once built.
- **Worker:** one Node process (`apps/worker`), run as a second Docker container on the same EC2 server as the web app; no separate AWS service for it. It runs RSS ingestion (one poller system-wide, at least 65 s between Reddit requests), post analysis, and the background jobs from the Postgres job table. Web code starts work by adding a job row (or calling an API), not through SQS.
- **AI:** Gemini, tiered by task: Flash-Lite for high-volume work (per-post extraction, scoring), Flash for drafts and onboarding imports. Calls go through our own interface so any task can switch model.
- **Matching:** rule filters + a rule score with a reason. The LLM re-score is built but off for the MVP (decided 2026-10-19, `RESCORE_ENABLED=false`); drafting picks the project to cite. Strict cross-post dedupe stays; the feed links every subreddit a gig was posted in.
- **Alerts:** Telegram Bot API (email/push later)
- **Payments:** subscriptions for US, UK and India customers; provider not chosen yet (Razorpay alone doesn't cover US/UK well)

Core tables: `profiles`, `job_posts`, `matches`, `replies`, `outcomes`, `client_reports` — fields in `docs/PROJECT.md` §8.

## Product decisions (2026-09-25)

- **Subreddits (revised 2026-10-01):** users are **not** connected to subreddits. One central catalogue (`packages/core/src/subreddit-catalogue.ts`, about 238 active hiring subreddits from two research passes in `docs/ingestion/research/`) is polled for everyone, and each user's feed is filtered by what a post asks for, not where it was posted. There is no subreddit step in onboarding. Later, paid plans can add a subreddit (`user_subreddits`, `tier = 'custom'`).
- **Trial:** the 5-day trial starts when onboarding finishes, not at sign-up.
- **Portfolio:** no portfolio step (decided 2026-09-29). Onboarding asks for an optional GitHub link instead (optional for everyone, on the Import step).
- **Voice:** no voice step at onboarding. Drafts start in a default short, plain style, and the user's voice is learned from their edits (store every AI draft and sent version from the first draft).
- **Drafts:** a comment and the **first DM** only. Don't market DM conversation handling, and don't state that we don't handle DMs.
- **Follow-ups (paid plans):** if a reply has no status marked after a few days, remind the user and draft a follow-up.
- **Subreddit insights (paid plans):** per subreddit, hiring posts per week, share matching the user's skills, posted-budget ranges and peak posting hours (in the user's time zone). Only from RSS-available fields; shown once a subreddit has enough posts (see rule 8).
- **Blocked words** removed from onboarding (user decision, 2026-09-29).

## Non-negotiable rules

1. **Never auto-post.** No auto-posting, bulk DMs, or anything that sends from a user's Reddit account without them clicking send. The UI offers an edit box + "Open post" button; the user sends.
2. **Source adapters.** Every data source (RSS now, Reddit API / HN / job boards later) goes through an adapter that emits one common `JobPost` shape. Matching, drafting and alerts must never depend on where a post came from.
3. **Store everything from day one.** Every post, its extracted fields, the author username, and every reported outcome. V2 features (rate insights, client memory, analytics) depend on this history.
4. **RSS limits.** Only title, body, author, link, timestamp are available — no flair, comment counts or author reputation. Don't build features that need those until the licensed-API phase. Signed-out RSS allows **1 request a minute per IP**: keep **at least 65 s** between requests (sooner still got 429s). A request returns at most 100 posts (`?limit=100`); combined feeds (`/r/a+b/new/.rss`) and `after=` paging work. Poll politely with a clear User-Agent; dedupe.
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

## Where we are (2026-10-17)

Handover for the next chat. Update this section as things change.

### Branches

- `main`: homepage + local backend foundation, merged through PR #1 on 2026-09-28.
- `feat/homepage`: kept on purpose (the user asked not to delete it); its work is already in `main`.
- `feat/onboarding` (at `5645aeb`, pushed): onboarding slices 1–3 (manual steps, worker + resume import, GitHub import). Not merged.
- `feat/ingestion` (stacked on `feat/onboarding`, so it holds onboarding too): ingestion Phases 1–4, **committed** 2026-10-02 (`3f424f9`) and pushed. Not merged. Docs reorganised 2026-10-17 (conclusions per feature).
- Tests: **601 pass** on 2026-10-17 (web 226, worker 216, core 82, db 51, llm 26); typecheck and lint clean. The worker tests deleted in commit `5645aeb` (broken by `a61bd1b` moving the fake LLM to `test/stub-llm.ts`) were restored on 2026-10-17, and `vertex:check` works again (not committed yet).

### In progress (2026-10-18)

- **Projects & experience** (resume import extracts projects and roles, client names scrubbed, a new onboarding step `/onboarding/work`):
  - slices 1–7 are built, the review is done and all 11 fixes are in;
  - still to do: the user's manual check on real resumes (slice 8 in `docs/onboarding/projects-experience-plan.md`) and `conclusion.md`;
  - build notes are in `docs/onboarding/projects-experience-build-notes.md`.
- **Matching + job feed backend:** built, reviewed and fixed (F1–F5), verified 2026-10-18: `docs/matching/conclusion.md`. The phase plan and build notes are still in `docs/matching/plan/` (delete them once the user has read the conclusion). Not run live end to end yet (real posts + Vertex re-scores + an onboarded profile). The AI re-scorer is **off** for the MVP (2026-10-19); when it's on, trial/Standard get 15 AI re-scores a day and Max ($20/month) gets 50.
- Tests on 2026-10-19: **1,124 pass** (web 299, worker 436, core 173, db 190, llm 26); typecheck, lint and `npm run build` clean. **Nothing is committed** (docs reorganisation, restored worker tests, Projects & experience, matching). Ask the user about commits.

### What's built (read the conclusions)

Each built feature has `docs/<feature>/conclusion.md`: what was built, how it works step by step, where the code is, how it connects, decisions, known gaps and deferred minors. They were checked against the code on 2026-10-17. **Read the relevant one before changing a feature, and update it when you change one.** `docs/README.md` has the status table and a whole-system diagram.

- `docs/foundation/conclusion.md`: Docker Postgres + Valkey, env, errors, logging, `apiRoute()`, rate limits (bucket fails open; quota fails closed and is used by imports), dev session auth, `/health`, `/me`, `/dev/session`, `/login`, `/dashboard`, `proxy.ts`.
- `docs/homepage/conclusion.md`: the 11 sections, techniques, and a table of **out-of-date copy** (Free/Pro plans, `/signup`, "connected to subreddits", portfolio wording).
- `docs/onboarding/conclusion.md`: steps, saving with versions, the import queue, worker resume pipeline, GitHub import, Finish (profile + trial; **no `user_subreddits`**), `@redlance/llm`, and the deviations from `design.md`.
- `docs/ingestion/conclusion.md`: catalogue, tables, poller/governor/planner, RSS adapter, analyser, upkeep, settings, scripts, results, gaps.
- `docs/matching/conclusion.md`: strict dedupe of cross-posts, the rule score, broad matches, the matcher, the AI re-scorer with per-plan daily caps, the feed API (`/api/v1/feed`), `match:status`.

Facts that are easy to get wrong:
- Taxonomy: 12 job types, 185 skills. Catalogue: 473 subreddits, 238 active (`packages/core/src/subreddit-catalogue.ts`, generated from `docs/ingestion/research/data/catalogue.json`; the generator script isn't in the repo).
- Not checked in a real browser yet (onboarding); the resume eval hasn't run live; Flash-Lite prices are placeholders.

### AWS and accounts

- **AWS account "Redlance":** us-east-1, IAM Identity Center (single-region) with an AdministratorAccess permission set, 8-hour sessions.
- **Credits lost:** enabling Identity Center created an AWS Organization, which **expired the Free Tier credits** ($100, plus the $100 still to earn). A support ticket has been sent asking for them back. Also apply for AWS Activate.
- **Nothing deployed yet.** Phases 0–2 would cost about $0 a month on the CloudFront flat-rate **Free plan** (includes WAF + Route 53, 1M requests, 100 GB and 5 WAF rules a month; no VPC origins, so the server is locked to CloudFront by security group + secret header). The user hasn't explicitly confirmed the flat-rate plan. Early draft: `docs/deployment/cdn-waf-design.md` (partly outdated, see its banner).
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

1. **Onboarding:** run the resume eval against Vertex (`npm run eval -w @redlance/worker -- --baseline`); click through the whole flow in a browser; then merge (user's call). The user still needs to look over the skill list. Vertex prices in `packages/llm/src/prices.ts` are from a third-party listing (gemini-3.8-flash introductory until 2026-12-31; flash-lite unverified) — confirm on the official pricing page.
2. **Ingestion (`feat/ingestion`):** a 24 h soak run; plan checks 0.1 (AWS CloudShell reachability) and 0.4 (Reddit API application); 0.2 and 0.3 answered 2026-10-01 (120 subreddits per URL work, banned ones are skipped; flair search works); then **matching** (next feature) and alerts, then deployment.
3. **Subreddit list:** the catalogue comes from a study (`docs/ingestion/research/`); the user still has to review it, and the worker logs subreddits outside it that have hiring posts (weekly discovery).
5. **Deployment spec:** EC2 + CloudFront + WAF with CDK. CloudFront must forward `Origin` and `CloudFront-Viewer-Address`. Run `/api/v1/health?deep=1` after every deploy. Check that Upstash supports `TIME` inside Lua. **Run migrations + `syncReferenceData()` before a new web build takes traffic** (a new skill in code but not yet in the `skills` table makes Finish fail on the `profile_skills` foreign key); `db:migrate` needs `tsx`, so ship a compiled migrate step. WAF: exempt `POST /api/v1/onboarding/imports/resume` from the 8 KB body rule. **Worker container:** needs `tsx` at runtime (the extraction thread starts with `--import tsx`; don't install with `--omit=dev`, or compile the worker), `stop_grace_period` ≥ 35 s, memory for up to 4 extraction threads (256 + 64 MB heap each) next to web and Postgres, non-root, read-only filesystem, network only to Postgres, Vertex AI, api.github.com and www.reddit.com. Google credentials on EC2: Workload Identity Federation from the AWS role (no key files). Set a Vertex request quota and a billing budget alert on the Google Cloud project.
6. **Still undecided:**
   - which features go in which plan, and credit amounts;
   - the payment provider;
   - alert channels for US/UK (email + Telegram suggested);
   - the homepage copy is out of date in several places (plans, `/signup`, subreddits); see `docs/homepage/conclusion.md`.

### Working style that worked

- Explain decisions with trade-offs and a recommendation.
- Features go spec → plan → test-first build, with one fresh code review of the whole branch at the end.
- The user is learning system design: explain new components clearly, with code.

