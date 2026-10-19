# Matching and the job feed (backend): plan

Date: 2026-10-17 · Status: **building**. Backend only; the feed UI comes later.

This folder is the plan. **Each phase has its own file** saying what to build, file by file, why, the edge cases, every test case, and when it's done. Read this README first, then the phase file you're working on.

| # | File | What | Model | Runs after |
|---|---|---|---|---|
| 1 | `01-dedupe.md` | Drop cross-posted duplicates at ingestion | Sonnet | — (parallel with 2) |
| 2 | `02-rule-score.md` | Candidate test, hard filters, rule score, reason (pure code in core) | Sonnet | — (parallel with 1) |
| 3 | `03-database.md` | Matching tables, plans, queues, feed query | Opus | 1 and 2 |
| 4 | `04-matcher.md` | Worker: match new posts, backfill, re-match | Opus | 3 |
| 5 | `05-rescorer.md` | Worker: AI re-score within each plan's daily cap | Opus | 4 |
| 6 | `06-feed-api.md` | `GET /api/v1/feed` and the status route | Sonnet | 3 (parallel with 4 and 5) |
| 7 | `07-ops.md` | Status reports for matching | Haiku | 5 |
| 8 | `08-review.md` | Fresh review of the whole feature, then fixes | Opus | 6 and 7 |
| 9 | `09-finish.md` | Full tests, `npm run build`, `conclusion.md` | main session | 8 |

How models are chosen:
- **Opus** for queues, concurrency, SQL that must agree with code, prompts and privacy.
- **Sonnet** for well-specified pure code and routes.
- **Haiku** for mechanical reporting.

## The flow

```
Reddit post (RSS, every 5 min)
  │
  ▼
STEP 0 · DEDUPE (Phase 1, ingestion, no AI)
  same author posted a near-identical copy (strict rule, see Decisions) within ±72 h?
  yes → stored, duplicate_of = first post, never analysed or matched
  │ no
  ▼
ANALYSIS (built, one Flash-Lite call per post)
  │ only kind = hiring and not full-time continue
  ▼
LAYER 1 · CANDIDATES (Phase 2 logic, Phase 3 SQL)
  shares a skill id  ─or─  post has no skills and shares a job type = BROAD
  │
  ▼
LAYER 1b · HARD FILTERS
  ≤ 7 days old · deadline not passed · remote-only user vs onsite post
  unpaid / commission-only / revshare only if include_unpaid · not dismissed · user active
  │
  ▼
LAYER 2 · RULE SCORE 0–100 (Phase 2, pure)
  → upsert matches row; it's in the feed NOW with a rule reason
  ai_status = pending        (score ≥ 50, not broad, and the plan allows AI)
              not_needed     (otherwise, including every broad match)
  │
  ▼
LAYER 3 · AI RE-SCORE (Phase 5, Flash-Lite, one call per post-user pair)
  highest rule score first; broad matches never go to AI
  needs one unit of today's plan cap (trial/standard 15, max 50) → else "capped"
  → score, reason, best project/role; final score = AI score
  │
  ▼
FEED API (Phase 6): best = score ≥ 60, newest first · all · statuses + events
```

When matching runs:

| Event | What happens | Phase |
|---|---|---|
| A post finishes analysis | Matched against all users | 4 |
| A user finishes onboarding | **Backfill**: matched against the last 3 days | 3 (request) + 4 (run) |
| A profile changes (later) | Re-match against the last 7 days | 3 + 4 (the hook exists; no UI yet) |

## Decisions (from the conversation, 2026-10-17)

| Topic | Decision | Why |
|---|---|---|
| When to compute matches | On post arrival (fan-out on write), plus backfill and re-match | Alerts need matches before anyone opens the feed; reads are one indexed query |
| Cross-posts | Dedupe at ingestion, **strict** (user decision 2026-10-18 after review): same author, ±72 h, normalised titles `pg_trgm` ≥ 0.9, bodies ≥ 0.8 (or both empty with identical titles), and every number in the title equal. The original is the copy stored first, and only analysable posts can be originals. **No embeddings** | A missed duplicate costs one extra analysis; a false merge hides a real gig. The review showed a loose rule (title + body ≥ 0.6) merged agency templates, "$10 vs $20" task series and "React vs React Native" |
| Posts with no skills | Broad match by job type, rule score capped at 45 (≤ 30 with today's weights), no alerts, **never AI re-scored** | Simpler than "implied skills". An "only when nothing else is pending" rule would still spend quota between polls and starve strong matches arriving later (user decision, 2026-10-17). Later option: spend leftover quota on broad matches at the end of the user's day |
| Implied skills | Not now | Revisit if more than ~25% of hiring posts have no skills |
| Embeddings for scoring | Not in v1 | They mostly agree with the rules and can't see constraints (in-house, equity-only, senior) |
| AI threshold | Rule score ≥ 50 | Spends AI money where it changes the ranking and where the reason matters |
| **Plans and daily AI caps** | **Trial 15 · Standard (≈ $8–10/month) 15 · Max ($20/month) 50.** Agency: undecided | User decision. At ~$0.00024 a call: Standard ≈ $0.11/month, Max ≈ $0.36/month of model cost |
| Who gets AI | Plan `standard` or `max`, or `trial` with `trial_ends_at > now()`. Expired trials keep rule scores only | No model spend on non-paying users |
| The feed never waits for AI | Rule score shown immediately; the AI score replaces it | Freshness is the core promise |
| Exploration below the threshold | Not now | User: keep it simple |
| Full-time roles | Excluded | Redlance is for freelance gigs |
| Unpaid / commission / revshare | Hidden unless `profiles.include_unpaid` | Most freelancers want paid work |
| Default feed | Best = score ≥ 60, newest first; All = everything | Gigs are a race |
| UI | Later | User decision |

**Plan prices are for subscriptions:** I read "$8–10 daily" as a monthly price. There are no payments yet, so `profiles.plan` is set by hand (SQL) until billing exists.

## Accepted limits (v1)

- The daily cap is spent first come, first served. Smarter budgeting (a rising threshold, a reserve, batching) comes next.
- The rule weights are starting guesses. Their breakdown is stored (`features`) so they can be tuned from saves and dismisses.
- No location matching for onsite gigs, no alerts, no drafts.

## How to work (every phase)

- **Test-first:** write the test cases listed in the phase file, watch them fail, then implement. Match the surrounding code's style and comment density.
- Docker must be running (`export PATH="$HOME/.docker/bin:$PATH"; npm run db:up`). Tests never call Vertex; use `createFakeTransport` from `@redlance/llm`.
- **Schema:** change it only in `packages/db/src/schema.ts`, then run `npm run db:generate` and rename the file to the planned name (drizzle-kit ignores `--name` through the root script). Then `npm run db:migrate`. `npm run db:reset` is allowed (build stage).
- Every phase ends green: `npm test`, `npm run typecheck` and `npm run lint` from the repo root.
- **Never commit.** The user decides commits. The tree holds uncommitted work from earlier features; leave it alone.
- **Handoff:** append a section to the session scratchpad file `matching-handoff.md` with the files, exact export names and signatures, and any deviations from the phase file.
- **Baseline before Phase 1:** 885 tests pass (web 277, worker 371, core 120, db 91, llm 26).

Migration names: Phase 1 = `0009_dedupe`, Phase 3 = `0010_matching`.
