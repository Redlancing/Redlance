# Redlance

Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

Status: pre-MVP — Next.js web app scaffolded, homepage not built yet. The full spec is in `docs/PROJECT.md` (transcribed from `Redlance_Project_Description.pdf`); read the relevant section before designing a feature, schema, or page.

## Repo layout and commands

npm workspaces monorepo (Node ≥ 20.9). Run everything from the repo root.

- `apps/web` — Next.js 16 (App Router, `src/`, TypeScript, Tailwind v4, React Compiler, shadcn/ui on Base UI). Next 16 differs from older versions: read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code.
- `packages/db` — `@redlance/db`: Drizzle schema, client and migrations (Postgres 17 + pgvector). Change the schema only via `npm run db:generate` + committed migrations.
- Server-only code lives in `apps/web/src/server/`. Every API route is under `/api/v1` and wraps its handler in `apiRoute()` (session → origin → input → Redis rate limit). Settings come from env vars validated in `src/server/env.ts`; copy `apps/web/.env.example` to `.env.local`.
- `brand/` — logo files and brand guide (`brand/README.md`). Brand colours are theme tokens in `apps/web/src/app/globals.css` (`flare-50…700`, `cream`, `ink`, `stone`, `bone`, `feed`, `danger`, `success`; shadcn's `primary` = `ink`, so buttons are near-black like Attio's). Fonts: `font-sans`/`font-heading` = Inter, `font-serif` = Fraunces (quotes only), `font-wordmark` = Bricolage Grotesque (logo only). The homepage follows the Attio teardown in `docs/research/attio-teardown.md`; the logo component is `apps/web/src/components/brand/logo.tsx`.
- Verbatim copy (one-liner, core promise) lives in `apps/web/src/lib/site.ts` — import it, don't retype it.
- Later: `apps/worker` (ingestion), `packages/*` (shared `JobPost` types etc.).

Commands: `npm run dev` (starts Docker db + cache, then Next) · `npm test` · `npm run db:up|db:down|db:migrate|db:generate|db:reset` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run format`. Add shadcn components with `npx shadcn@latest add <name> -c apps/web`.

## Core loop

Collect (RSS poll every 2–3 min) → Understand (LLM extracts skills, budget, paid/unpaid, remote, deadline) → Match (0–100 score + one-line reason) → Alert (Telegram) → Draft (comment + DM, in the user's voice) → **human sends** → Learn (edits and outcomes feed back).

## Planned stack

- **Web:** Next.js (React Native/Expo later)
- **Cloud:** all AWS (decided 2026-09-26; replaces the Supabase plan), region us-east-1, infrastructure as code with AWS CDK (TypeScript) in `infra/`.
- **Request path:** CloudFront (CDN) → WAF (managed rules + per-IP rate limit) → one EC2 server running the app in Docker (decided 2026-09-26 after the AWS Free Tier credits were lost). Add an ALB + ECS Fargate when a second server is needed; the app stays stateless so that's an infrastructure change only. Per-user rate limits run in the app against Redis. No AWS API Gateway until there are several backend services or a public API; routes live under `/api/v1`.
- **Data:** Postgres 17 + pgvector runs as a Docker container, on the laptop and on the EC2 server (no RDS, to save cost), with a tested daily backup to S3. Redis: a Valkey 8 container locally, **Upstash** in production (no ElastiCache); only `REDIS_URL` differs, and Redis only holds rebuildable data. Frequent health checks must not touch Redis (Upstash bills per command). Redis is used from day one for per-user rate limits (token bucket), daily quotas and hot caches; S3 for uploads and static assets; SQS + a worker service for slow jobs.
- **Auth:** Cognito (Essentials) with Google + email one-time code, no passwords. Tokens in httpOnly cookies, verified in the app on every request; our `users` table is keyed by the Cognito `sub`.
- **Workflow:** build and test each feature locally first (Docker: Postgres + Valkey; a dev Cognito pool), then deploy. Specs live in `docs/superpowers/specs/`.
- **Ingestion worker:** Node service, every 2–3 min (runs on the same server at first)
- **AI:** Gemini, tiered by task: Flash-Lite for high-volume work (per-post extraction, scoring), Flash for drafts and onboarding imports. Calls go through our own interface so any task can switch model.
- **Matching:** embeddings shortlist + rule filters, then LLM re-score with reasons
- **Alerts:** Telegram Bot API (email/push later)
- **Payments:** subscriptions for US, UK and India customers; provider not chosen yet (Razorpay alone doesn't cover US/UK well)

Core tables: `profiles`, `job_posts`, `matches`, `replies`, `outcomes`, `client_reports` — fields in `docs/PROJECT.md` §8.

## Product decisions (2026-09-25)

- **Subreddits:** at onboarding Redlance connects the user to the right subreddits for their skills; users can add more but don't have to pick any.
- **Trial:** the 5-day trial starts when onboarding finishes, not at sign-up.
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
6. **Drafts must sound human:** short, reference the client's specific problem, link the single most relevant portfolio piece.
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
