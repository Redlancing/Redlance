# Redlance

Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

Status: pre-MVP — Next.js web app scaffolded, homepage not built yet. The full spec is in `docs/PROJECT.md` (transcribed from `Redlance_Project_Description.pdf`); read the relevant section before designing a feature, schema, or page.

## Repo layout and commands

npm workspaces monorepo (Node ≥ 20.9). Run everything from the repo root.

- `apps/web` — Next.js 16 (App Router, `src/`, TypeScript, Tailwind v4, React Compiler, shadcn/ui on Base UI). Next 16 differs from older versions: read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code.
- `brand/` — logo files and brand guide (`brand/README.md`). Brand colours are theme tokens in `apps/web/src/app/globals.css` (`flare-50…700`, `cream`, `ink`, `stone`, `bone`, `feed`, `danger`, `success`; shadcn's `primary` = `ink`, so buttons are near-black like Attio's). Fonts: `font-sans`/`font-heading` = Inter, `font-serif` = Fraunces (quotes only), `font-wordmark` = Bricolage Grotesque (logo only). The homepage follows the Attio teardown in `docs/research/attio-teardown.md`; the logo component is `apps/web/src/components/brand/logo.tsx`.
- Verbatim copy (one-liner, core promise) lives in `apps/web/src/lib/site.ts` — import it, don't retype it.
- Later: `apps/worker` (ingestion), `packages/*` (shared `JobPost` types etc.).

Commands: `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run format`. Add shadcn components with `npx shadcn@latest add <name> -c apps/web`.

## Core loop

Collect (RSS poll every 2–3 min) → Understand (LLM extracts skills, budget, paid/unpaid, remote, deadline) → Match (0–100 score + one-line reason) → Alert (Telegram) → Draft (comment + DM, in the user's voice) → **human sends** → Learn (edits and outcomes feed back).

## Planned stack

- **Web:** Next.js (React Native/Expo later)
- **Backend/DB:** Supabase — Postgres, Auth, Edge Functions, pgvector for matching
- **Ingestion worker:** Node or Python cron, every 2–3 min
- **AI:** LLM API for extraction, scoring, drafting, style profiles
- **Matching:** embeddings shortlist + rule filters, then LLM re-score with reasons
- **Alerts:** Telegram Bot API (email/push later)
- **Payments:** Razorpay (UPI, cards), INR subscriptions

Core tables: `profiles`, `job_posts`, `matches`, `replies`, `outcomes`, `client_reports` — fields in `docs/PROJECT.md` §8.

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

- **Trademark:** never put "Reddit" in the product name, domain or logo, and never use Reddit's alien mascot. Use "Reddit" only descriptively in body text ("find freelance jobs on Reddit") and never imply an official connection.
- **One-liner, word for word everywhere** (homepage, meta description, social bios): "Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice."
- **Core promise:** "See the right Reddit gigs first, and reply in under two minutes with a message that sounds like you."
- **SEO: pages rank, not names.** One page per target search — `/reddit-freelance-jobs`, `/reddit-web-developer-gigs`, `/reddit-video-editing-jobs`, `/best-subreddits-for-freelancers` — plus guides, comparison pages ("Redlance vs Upwork"), and a public feed of latest hiring posts (short snippet + link back only).
- **AEO:** question headings followed by a 40–60 word direct answer, then detail; FAQ and HowTo structured data.
- Primary audience: early-career freelancers in India, then niche specialists. Pricing in INR.

## Plans

Free: alerts delayed 30–60 min, a few drafts/day, basic tracker. Pro: instant alerts, unlimited drafts, voice learning, follow-ups, rate insights. Agency (V2): multiple profiles, gig routing, team analytics.

## Roadmap

Phase 0 (wks 1–2): Telegram bot, one niche, 10–15 subreddits → Phase 1 (wks 3–8): web app MVP (profile, scoring, drafts, red flags, tracker) → Phase 2 (months 3–4): Razorpay Pro, follow-ups, voice learning → Phase 3 (months 4–8): rate insights, client memory, analytics, more sources, licensed Reddit API.

North-star metric: gigs won per active user per month.
