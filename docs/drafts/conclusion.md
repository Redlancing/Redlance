# Drafts and the reply tracker (backend): conclusion

**Status (2026-10-20):**
- The whole backend is built: how-to-apply extraction, the evidence builder, the draft and rewrite calls, validators, credits and limits, the reply tracker, voice learning, the example library and the eval harness. There is **no UI yet**.
- It lives in the working tree on `feat/drafts`. **Nothing is committed.**
- Tests: **1,538 pass** (web 377, worker 562, core 282, db 291, llm 26). On `main` it is 1,124. `typecheck`, `lint` and `npm run build` are clean.
- A fresh Opus review found 1 high, 5 medium and 9 low problems. All are fixed, each with a test that failed first, except L6 (see the gaps).
- **Not done yet:**
  - a live run against Vertex (prompts, eval, voice notes);
  - the draft and tracker UI, reminders and follow-ups, payments and the monthly credit grant.
- Steps 5 and 6 of the core loop (Draft, and the human-send part of Learn) are done on the backend. Alerts are not.

The spec is `README.md` in this folder and the phase log is `plan/build-notes.md`. Both stay until the user has read this file. Where they differ from this file, this file (checked against the code) is right.

## In one paragraph

The user clicks "Draft" on a match. The web app checks the plan, the caps and the credit balance, reserves 7 credits, and inserts a `drafts` row that doubles as a queue job. The worker claims the row, builds the **evidence** with plain code (best project and role, the matched skills, one link, a rate note), makes one **Gemini Flash** call that plans first and then writes a public **comment** and a **first DM**, and runs **validators** on the result. A failure gets one retry with the problems listed. The user edits the text for free, sends it on Reddit themselves (rule 1), and marks it sent. That creates a `replies` row, measures how much the user changed, and feeds their **voice**. Later the user marks what happened (`replied`, `hired`, `lost`, ...), which writes `outcomes` rows. Rewrites (shorter, more casual, more formal, a different project, or a typed instruction) make new versions, up to 5 per post. Credits are priced by what each task costs us and are refunded once if the draft fails.

## The big picture

```
 ingestion + matching (already built)
 analyser ─► job_post_analyses (+ apply_instructions) ─► matcher ─► matches
                                                              │
 apps/web   POST /api/v1/drafts {matchId, idempotencyKey}     │ user clicks Draft
            checks ─► reserve credits ─► insert drafts row ─► pg_notify('drafts')
                                                              ▼
 apps/worker  DRAFTER  claim (SKIP LOCKED) ─► loadDraftContext ─► buildEvidence
                       ─► Flash call (plan, comment, DM) ─► validateDraft
                       ─► one retry with the errors ─► completeDraft
                       final failure ─► failDraft + refund (once)
              browser polls GET /api/v1/drafts/:id until status = done
                                                              │
 user edits ─► sends on Reddit ─► POST /api/v1/replies {draftId, kind, sentText}
            ─► replies + reply_sends + matches.status = 'replied'
            ─► measureSend ─► recordSend ─► (3rd send, then every 5) voice job
            PATCH /api/v1/replies/:id {status} ─► outcomes row
                                                              │
 worker  VOICE UPDATER  Flash-Lite rewrites the voice notes ─► next draft's <voice>
```

The AI call runs in the **worker**. The web app never calls Vertex, so Google credentials stay in one process. There is no SQS: the queue is the `drafts` table with `NOTIFY` and a 5-second poll as the safety net, like imports, ingestion and matching.

## Where the code is

| Part | Files |
|---|---|
| Pure rules (`@redlance/core`) | `packages/core/src/drafts/`: `plans.ts` (credits, caps, limits, rewrite options), `types.ts`, `evidence.ts` (`buildEvidence`, `rankProjects`, `rankRoles`), `validate.ts` (`validateDraft`, `lengthTarget`, `findUrls`, `findNumbers`), `voice.ts` (`measureSend`, `updateStats`, `statsToTargets`, `shouldUpdateVoice`, `pickBestSends`), `text.ts` (`editRatio`, word and sentence counts), `banned.ts`, `examples.ts` (16 hand-written examples) |
| Draft storage and queue | `packages/db/src/drafts.ts` (`loadDraftContext`), `draft-jobs.ts` (`createDraftJob`, `claimNextDrafts`, `completeDraft`, `failDraft`, `requeueStaleDrafts`, `expireStuckDrafts`, `addEvalCandidate`, `draftVersions`), `draft-evidence.ts` (evidence rebuilt for rewrites) |
| Credits | `packages/db/src/credits.ts`: `grantCredits`, `grantPlanCredits`, `reserveCredits`, `refundCredits`, `creditsUsedToday`, `costTodayMicros`, `systemDraftCostTodayMicros`, `getCredits`, `draftBudget`, `isDraftingPaused`, `onceADay` |
| Voice storage | `packages/db/src/voice.ts`: `recordSend`, `claimVoiceUpdates`, `completeVoiceUpdate`, `failVoiceUpdate`, `requeueStaleVoiceUpdates`, `loadVoice`, `loadVoicePairs`, `loadOrganisations` |
| Example library sync | `packages/db/src/reference.ts`: `syncReferenceData()` writes `draft_examples`; `pickExamples` |
| Schema and migrations | `packages/db/src/schema.ts`; migrations `0012_drafts.sql`, `0013_credit_refund_once.sql`, `0014_failed_versions_reply_sends.sql` |
| Worker: drafting | `apps/worker/src/drafts/`: `prompt.ts` (`DRAFT_SYSTEM`, `buildDraftPrompt`, `draftOutputSchema`, `DRAFT_PROMPT_VERSION = "draft@1"`), `generate.ts` (`generateDraft`), `drafter.ts` (`createDrafter`: the queue loop) |
| Worker: voice | `apps/worker/src/drafts/voice-job.ts` (`createVoiceUpdater`, `createVoiceLoader`, `VOICE_SYSTEM`, `VOICE_PROMPT_VERSION = "voice@1"`) |
| Post analysis | `apps/worker/src/ingest/analyse-post.ts` (`apply_instructions`; `PIPELINE_VERSION = "post@3"`, `PROMPT_VERSION = "post-extract@3"`) |
| Web server code | `apps/web/src/server/drafts.ts`, `replies.ts` |
| Routes | `apps/web/src/app/api/v1/drafts/route.ts`, `drafts/[id]/route.ts`, `drafts/[id]/rewrite/route.ts`, `drafts/[id]/feedback/route.ts`, `replies/route.ts`, `replies/[id]/route.ts`, `credits/route.ts` |
| Eval | `apps/worker/test/eval/drafts/`: `run.ts`, `judge.ts`, `cases/` (50 JSON files), `profiles.ts`, `cases.ts`, `candidates.ts`, `winners.ts`, `export-cases.ts`, `report.json`, `guard.test.ts` |
| Dev script | `apps/worker/scripts/grant-credits.ts` |
| Wiring and settings | `apps/worker/src/index.ts`, `env.ts`, `.env.example`; `apps/web/src/server/env.ts`, `.env.example`, `errors.ts`, `rate-limit/index.ts` |
| Trial grant | `apps/web/src/server/onboarding/service.ts`: `finishOnboarding` calls `grantPlanCredits(tx, ..., "trial", trialEndsAt)` in its own transaction |

## How it connects to the rest

| Feature | Link |
|---|---|
| Ingestion | The analyser now also extracts `apply_instructions` (the post's own "how to apply" text) into `job_post_analyses`. It keeps the value only when a quoted piece of it is really in the post, and only for `kind = hiring`. The feed API returns it as `post.applyInstructions`. |
| Matching | A draft starts from a `matches` row. The matched skills come from `matches.features`. Sending sets `matches.status = 'replied'` and writes a `match_events` row. The AI re-scorer is off, so `best_project_id` is usually null; code ranks the projects itself. |
| Onboarding | Drafts read the saved profile, visible projects and roles, and the GitHub username. `finishOnboarding` grants the trial credits. Hidden entries are never loaded. |
| LLM | Calls go through `@redlance/llm`. Every attempt is recorded in `llm_usage` with task `draft`, `rewrite` or `voice`. |

## The tables and columns added

| Table | What it holds |
|---|---|
| `job_post_analyses` (changed) | `apply_instructions` (at most 300 characters, null) |
| `drafts` | One row per version (1 to 5) and also the queue job: `status` (`pending`, `running`, `done`, `failed`), `attempts`, `run_after`, `locked_at`, the plan fields (`problem`, `cited_fact`), `comment`, `dm`, `evidence` (jsonb), `warning`, `problems`, `model`, `prompt_version`, tokens, `cost_micros`, `timings`, `credits`, `idempotency_key`, and for rewrites `parent_id`, `option`, `instruction` |
| `credit_balances` | One row per user: `plan`, `balance` (never below 0), `period_start`, `period_end` |
| `credit_ledger` | Every change: `delta` and `reason` (`grant`, `reserve`, `refund`, `expire`, `adjust`), with the `draft_id` |
| `replies` | The **latest** send per post and kind (comment or DM): `sent_text`, `edit_ratio`, `sent_at`, `status`, `remind_at` (stored, never set yet) |
| `reply_sends` | Append-only: **every** "mark as sent". Added in `0014` after the review, to keep rule 3 (store everything) |
| `outcomes` | One row per status change, with the agreed rate when hired |
| `voice_profiles` | `notes` (at most 600 characters), `previous_notes`, `stats` (jsonb), counters, `best_reply_ids` (at most 2), and the job fields (`update_status`, `update_run_after`, `update_locked_at`, `updates_day`, `updates_today`) |
| `draft_examples` | The example library; `source` is `handwritten` or `winning` |
| `draft_eval_candidates` | Drafts worth a human look; unique on draft and reason |
| `draft_feedback` | A thumbs-down with an optional reason (at most 300 characters) |

Constraints worth knowing:
- Every enum column has a CHECK constraint, and a test keeps the lists in `schema.ts` equal to the ones in core.
- `replies.match_id` is nullable with `on delete set null`: a sent reply is history and survives its match.
- Uniqueness of (`user_id`, `match_id`, `version`) is a **partial index, only where `status <> 'failed'`**. A failed draft frees its version number.
- `credit_ledger (draft_id)` is unique where `reason = 'refund'`: a draft can be refunded **once**, enforced by the database.
- `drafts (user_id, idempotency_key)` is a partial unique index.
- `llm_usage (user_id, created_at)` was added, because the per-user daily cost check runs on every draft request.

## Draft flow, step by step

1. **Web checks** (`POST /api/v1/drafts` with `matchId` and `idempotencyKey`). The match must be the user's and not withdrawn (404). The plan must allow AI (403 `PLAN_EXPIRED`). If a draft for this key, or a v1 for this match, already exists, it is returned (200) at no cost, even at the cap. Then the daily credit cap and the daily cost cap (429 `DAILY_LIMIT`), the system pause (503), and the balance (402 `INSUFFICIENT_CREDITS`). A key reused for another match is 409 `IDEMPOTENCY_CONFLICT`.
2. **Reserve and insert**, in one transaction: take 7 credits (a ledger row), insert `drafts` v1 as `pending`, `pg_notify('drafts', id)`. The answer is 202 `{ draftId, status, slowDown }`. `slowDown` is true after 10 drafts in an hour (Redis, a warning only, fails open).
3. **Claim.** The drafter takes pending rows with `FOR UPDATE SKIP LOCKED`, bumps `attempts`, and works up to `DRAFT_CONCURRENCY` at once. The claim number (`attempts`) fences every later write.
4. **Context and evidence.** `loadDraftContext` reads the match, post, analysis, profile, visible projects and roles (one join and four parallel queries). `buildEvidence` (pure) works out:
   - the best project and role: skills the user has as core count 3, other post skills 1, a shared category 2, a shared domain 1; ties go to the latest year. A project is cited only with a score above 0, so an unrelated project is never cited, unless the match row names one;
   - the top 3 matched skills, in the post's own order;
   - the one allowed link: the project's first link, else `https://github.com/<username>`, else none;
   - the rate note, reusing `budgetFit()`: it only says the posted budget fits; below the minimum, or no budget, means no rate in the draft;
   - availability: a deadline within 7 days gives "can start this week", otherwise nothing;
   - red flags (including unpaid, commission-only and revshare pay types): shown to the **user**, never put in the prompt.
5. **Privacy.** Employer names are used only when `mentionEmployers` is on; otherwise only the organisation description. Names are scrubbed (`scrubOrganisations`) from summaries and highlights using the names of **every** role, hidden ones included (`allOrganisations`).
6. **The call.** `generateDraft` calls `DRAFT_MODEL` (Flash by default), temperature 0.7, thinking off, 800 output tokens, 15 s timeout, one LLM-level retry for provider errors. Prompt order: fixed system and playbook, then `<examples>` (2 or 3 for the post's job type), `<voice>`, `<post>` (body cut at 3,000 characters), `<apply>`, `<evidence>`, then the task line with the DM word range. The fixed part is about 1,400 tokens and the variable part about 300, so Gemini can cache the front. Outside text has `<` and `>` swapped for look-alike characters (nothing is deleted). Output (zod) is in this order, so the model plans before writing: `problem`, `citedFact`, `applyInstructions`, `comment`, `dm`.
7. **Validators.** `validateDraft` returns problems:

   | Code | Meaning |
   |---|---|
   | `COMMENT_TOO_LONG` | over 300 characters or 3 sentences |
   | `DM_TOO_SHORT` / `DM_TOO_LONG` | outside the target: 60 to 150 words by default; with voice stats, the user's average plus or minus 50%, kept within 40 to 180. A blank DM next to a comment is too short |
   | `BANNED_PHRASE` | "I came across your post", "kindly", and the rest of the list |
   | `UNKNOWN_LINK` | any URL that is not the one allowed link, including bare domains such as `example.io` |
   | `UNSUPPORTED_NUMBER` | a number claim not found in the evidence, the post or the user's instruction |
   | `ORGANISATION_NAME` | an employer name while `mentionEmployers` is off |
   | `EMPTY` | no comment and no DM |

   A number is a claim if it has a currency sign, `%`, `k`/`m`/`x`, a decimal, a value above 10, or "years", "yrs" or "clients" after it. Claims are matched by value, loosely: "40%" passes if a "40" is anywhere in the evidence or post. Digits inside URLs are not claims. Bare domains skip tool names from the taxonomy ("ASP.NET", "Make.com", "Socket.io") unless they have a path.
8. **Retry.** On the first failure the problems are sent back and the model tries once more. If the retry still fails, the draft is saved with `warning = true` and the problem list, and an eval candidate (`validator_failed_twice`) is added. If the retry call itself throws (or hits the 40 s per-draft limit), the first answer is kept with a warning.
9. **Save.** `completeDraft` is fenced on `status = running` and the same `attempts`. The credits are kept. Logs carry ids and codes, never post or profile text.
10. **Failure.** Up to `MAX_DRAFT_ATTEMPTS` (3) tries with a backoff of `2^attempts` seconds. A final failure calls `failDraft`, which locks the balance row first, does the fenced update, and refunds only if the row became `failed`. A second call returns `"lost"`.
11. **Stuck drafts.** Every minute the drafter requeues rows that have been `running` for over 60 s (on attempt 3 they fail with `STALE` and are refunded). `expireStuckDrafts` fails anything still `pending` or `running` 10 minutes after it was made (`EXPIRED`) and refunds it once. The web app calls it for one draft on start and on every poll, so a stopped worker cannot hold credits.
12. **Polling.** `GET /api/v1/drafts/:id` returns `status`, `version`, `comment` and `dm` (null until done), `warning`, problem **codes only** (the details can quote the post), `evidenceSummary`, `applyInstructions`, `redFlags`, `creditsCharged`, and for a failed draft its `error` code. It never returns the evidence text, the prompt or the plan fields. `GET /drafts?matchId=` lists the versions that did not fail.

A failed v1 does not block the match: the next `POST /drafts` with a new key makes a new v1 row (a new id; the refund-once rule is per draft id). Failed rows do not count toward the 5 versions.

## Rewrite flow

`POST /api/v1/drafts/:id/rewrite` takes `{ option }` (`shorter`, `casual`, `formal`, `different_project`) or `{ instruction }` (at most 200 characters), plus an idempotency key.

| Step | What happens |
|---|---|
| Pre-checks | The draft is the user's and `done` (else 409 `DRAFT_NOT_READY`). Fewer than 5 versions (else 409 `MAX_VERSIONS`). The match is not withdrawn (409 `MATCH_WITHDRAWN`) and, for `different_project`, another project exists (409 `NO_OTHER_PROJECT`). These last two charge nothing. A rewrite race gives 409 `VERSION_CONFLICT`. |
| Cost | `different_project` is 7 credits on Flash (`DRAFT_MODEL`). The others are 1 credit on Flash-Lite (`REWRITE_MODEL`). |
| Evidence | **Rebuilt from the current profile** on every rewrite, so a project hidden since the parent was written is not cited. The parent's project and role are pinned while they are still visible. `different_project` excludes the ones already cited. A now-hidden project's title and link are stripped from the `<previous>` block. |
| Prompt | The same fixed part, plus the previous version, the option or instruction, and "write a clearly different version". The typed instruction counts as evidence, so a number the user typed may appear. |
| Retry | A Flash-Lite rewrite that fails validation is retried once on Flash, with no extra credits. |
| Review queue | The 3rd rewrite on one post adds an eval candidate (`many_rewrites`). |

Credits and ownership are checked the same way as for a first draft. A cross-user rewrite is refused (tested).

## Send, tracker and outcome

- **`POST /api/v1/replies`** with `{ draftId, kind: "comment" | "dm", sentText }` (at most 10,000 characters). The draft must be the user's. One transaction writes the `replies` row (the latest send), a `reply_sends` row, sets `matches.status = 'replied'` and writes a `match_events` row. Marking the same post and kind again keeps the status, and updates the text.
- The **edit ratio** is the word-level edit distance divided by the AI's word count, capped at 1. It is null when the AI text is empty. Above 0.6 the draft goes to the eval review queue (`heavy_edit`).
- After the commit, in a try/catch (a voice failure never fails a send), `measureSend` and `recordSend` run. Only a new reply with AI text is counted.
- **`PATCH /api/v1/replies/:id`** with `{ status, agreedRateMinor?, currency? }`. Statuses are `replied`, `hired`, `lost`, `no_reply`, `ghosted`; `unpaid` is an outcome type only. Each change writes an `outcomes` row. Marking `unpaid` writes one extra `unpaid` row beside the status row, and only one per reply.
- **`GET /api/v1/replies`** lists the tracker, with a cursor and a status filter.
- `docs/PROJECT.md` section 8 calls the outcomes responded / won / lost. Here they are replied / hired / lost, plus no_reply, ghosted and unpaid.
- `replies.remind_at` is **never set**. Reminders wait for the email system.

## Voice learning

1. **Every send** is measured by code for free (`measureSend`): words, words per sentence, greeting, sign-off, emoji, exclamations, lowercase start, link and its position, rate mention, edit ratio. `recordSend` folds this into running averages in `voice_profiles.stats` under a row lock.
2. **A voice update is queued** (`update_status = 'pending'` and `pg_notify('voice')`) on the 3rd send, then every 5 sends after, or when the same style rewrite option was used 3 times in a row. At most 2 updates a day per user. The same-option streak counts style rewrites only.
3. **The updater** (`createVoiceUpdater`: listener on `voice`, 15 s poll, 60 s stale sweep, concurrency 2) calls Flash-Lite (`REWRITE_MODEL`), temperature 0.3, 250 output tokens. Inputs are scrubbed: employers become descriptions, URLs become `[link]`, angle brackets are replaced, each text is cut to 1,200 characters. It sees the previous notes, recent pairs (AI draft against sent text), the rewrite options used and the stats.
4. **The notes** are rewritten, never appended: 60 to 100 words, at most 600 characters, scrubbed again and cut. The old notes go to `previous_notes` (one step of rollback) and `version` goes up by one. A stale `running` row (over 120 s) is requeued.
5. **The best sends** (up to 2 reply ids) are the lowest edit ratio, with a replied or hired reply winning ties. They go into the draft's `<voice>` block next to the notes, with URLs turned into `[link]`.
6. **How it feeds a draft:** the notes, the stats as numbers (which also set the DM length target), and the best sends. All of it is empty for a new user.

Voice calls cost no credits and ignore the drafting budget pause (they are capped at 2 a day per user).

## Example library and eval

- **Seed:** 16 hand-written examples in `packages/core/src/drafts/examples.ts` (3 each for development, video, design and writing, plus 4 general). `syncReferenceData()` writes them to `draft_examples`; it never touches `source = 'winning'` rows. Examples quote no prices of their own. The system prompt says placeholders in examples (`{link}`, `{number}`, `{project}`) stand for real values.
- **Winning drafts:** `eval:winners` lists DMs whose reply reached `replied` or `hired`, with an edit ratio of 0.3 or less and at least 20 words. `--promote` removes employers, the display name, the GitHub username, `u/` names, emails and phone numbers, turns URLs into `{link}`, backed numbers into `{number}`, the cited project or role into `{project}`, and masks post budgets. Unbacked numbers are refused. It saves the **sent** text as `winning-<replyId>`.
- **Eval cases:** 40 draft cases and 10 rewrite cases in `apps/worker/test/eval/drafts/cases/`, with 5 synthetic profiles. They include hard cases: DM only, no budget, vague post, junior profile, broad match, Hinglish, a prompt-injection post, a "start with a code word" post. Cases carry tags so the coverage counts are explicit.
- **Scoring:** the validators (code) plus an AI judge (`judge@1`): specific, follows instructions, sounds human, cited work fits (1 to 5 each), invented facts (yes plus a quote), and per-case `expect` checks.
- **Report and guard:** `report.json` records the prompt version and model. `guard.test.ts` is a normal unit test that fails if `DRAFT_PROMPT_VERSION` no longer matches the report, or a case id is missing from it. Changing the prompt forces a new run; CI needs no Google credentials.
- **Review queue:** `draft_eval_candidates` collects drafts with reasons `validator_failed_twice`, `heavy_edit`, `many_rewrites` and `thumbs_down` (from `POST /drafts/:id/feedback`). `eval:candidates` lists them and `--add` / `--skip` marks them. A person copies new kinds of mistakes into the cases.

## Credits and limits

One credit is about $0.0007 of our AI cost. The numbers are constants in `packages/core/src/drafts/plans.ts`, not code.

| Task | Model | Credits |
|---|---|---|
| First draft | Flash | 7 |
| Rewrite: different project | Flash | 7 |
| Rewrite: shorter, casual, formal, typed | Flash-Lite | 1 |
| Opening or editing a draft | none | 0 |
| Validator retry, Flash fallback | either | 0 |

| Plan | Credits per period | About first drafts | Daily credit cap | Daily cost cap per user |
|---|---|---|---|---|
| Trial (5 days) | 210 | 30 | 105 | $0.20 |
| Standard | 2,100 | 300 | 210 | $0.40 |
| Max | 5,600 | 800 | 560 | $1.00 |

- **No rollover.** A grant replaces the balance for the new period.
- **Reserve, keep, refund.** Every money transaction locks the user's `credit_balances` row first. The reserve is a guarded `UPDATE ... WHERE balance >= amount`. A test without the lock let 20 drafts through instead of 15. A refund happens once per draft (a unique index).
- **Daily caps are computed in Postgres** from the ledger and `llm_usage` (UTC day), not in Redis. `creditsUsedToday` counts only refunds of same-day reserves.
- **Other limits:** at most 5 versions per post (35 credits on one post at most); a rewrite instruction of at most 200 characters; 2 voice updates a day; the hourly "slow down" warning at 10 drafts (Redis, fails open).
- **System budget:** drafting alerts at `DRAFT_BUDGET_ALERT_USD` (default $40) and pauses at `DRAFT_BUDGET_PAUSE_USD` (default $80), summed over today's `llm_usage` rows for tasks `draft`, `rewrite` and `voice`. While paused, new requests get 503 and pending drafts wait. The alert is logged once a day.
- **Grants:** the trial grant (210 credits, period ending at `trialEndsAt`) happens inside `finishOnboarding`. `grantPlanCredits` is ready for payments.
- **`GET /api/v1/credits`** returns `plan`, `balance`, `periodEnd`, `repliesLeft` (balance divided by 7), `usedToday` and `dailyCap`.

New error codes: `INSUFFICIENT_CREDITS` 402, `DAILY_LIMIT` 429, `PLAN_EXPIRED` 403, `MAX_VERSIONS` 409, `DRAFT_NOT_READY` 409, `IDEMPOTENCY_CONFLICT` 409, `VERSION_CONFLICT` 409, `MATCH_WITHDRAWN` 409, `NO_OTHER_PROJECT` 409.

## Cost

Prices in `packages/llm/src/prices.ts` are **not confirmed** (Flash is from a third-party listing, Flash-Lite is a placeholder).

| Call | Cost |
|---|---|
| Flash draft (about 3,500 in, 600 out, retries included) | about $0.005 |
| Flash-Lite rewrite | about $0.0007 |
| Voice update | about $0.0003 |
| `apply_instructions` in analysis | about $0.00001 per post |
| Standard or Max, all credits used | about $1.50 or $4.00 a month |
| One eval run | about $0.50 to $1 |

Risks: thinking tokens (keep thinking off), caching not applying (about 40% more input), and Flash prices doubling on 2027-01-01 (then a draft costs about 14 credits, or the plan amounts change; it is a constants change).

## Settings

Worker (`apps/worker/.env.local`):

| Variable | Default | Meaning |
|---|---|---|
| `DRAFTS_ENABLED` | true | Run the drafter |
| `VOICE_ENABLED` | true | Run the voice updater (needs `DRAFTS_ENABLED`) |
| `DRAFT_MODEL` | `VERTEX_MODEL_SMART` (Flash) | First drafts and "different project" rewrites |
| `REWRITE_MODEL` | `VERTEX_MODEL_FAST` (Flash-Lite) | Style rewrites and voice notes |
| `DRAFT_CONCURRENCY` | 4 | Drafts in flight at once |
| `DRAFT_BUDGET_ALERT_USD` | 40 | Log an alert once a day above this |
| `DRAFT_BUDGET_PAUSE_USD` | 80 | Pause drafting above this (must not be below the alert value) |

The web app (`apps/web/.env.local`) reads the two budget variables too, for the pause check on `POST /drafts`. Fixed in code: `TASK_CREDITS`, `PLAN_CREDITS`, `DAILY_CREDIT_CAP`, `DAILY_COST_CAP_MICROS`, `MAX_VERSIONS` 5, `HOURLY_WARNING` 10, `HEAVY_EDIT_RATIO` 0.6, `MAX_DRAFT_ATTEMPTS` 3, `DRAFT_EXPIRE_AFTER_SEC` 600, the voice triggers (`VOICE_FIRST_AFTER` 3, `VOICE_EVERY` 5, `VOICE_MAX_PER_DAY` 2).

## Commands

```sh
npm run eval:drafts -w @redlance/worker -- [--model X] [--judge-model Y] [--baseline] [--stub] [--cost-limit 3]
npm run eval:candidates -w @redlance/worker -- [--add|--skip]     # the review queue
npm run eval:winners -w @redlance/worker -- [--promote]           # winning sends for the library
npm run eval:export-cases -w @redlance/worker                     # export real posts as eval cases
npm run credits:grant -w @redlance/worker -- --email you@example.com --plan trial|standard|max [--days N]
```

`credits:grant` runs only with `APP_ENV=local` or `test`. It replaces the user's balance (no rollover); the default period is 5 days for a trial and 30 for a paid plan. `eval:drafts --baseline` prints the cases that got worse. Wiring in `index.ts`: the drafter and the voice updater each get their own `LISTEN` connection (`drafts`, `voice`), start after the matcher and stop with the others.

## Decisions worth remembering (and why)

- **One AI call writes the plan, the comment and the DM.** Planning first (problem, fact to cite, instructions to follow) keeps the text on the client's specific problem.
- **Evidence is built by code, not by the model.** The model may use only the project, link and skills it is given, and the validators catch invented numbers, links and employer names.
- **The draft row is the queue job.** No new queue system; `NOTIFY` plus `SKIP LOCKED`, as everywhere else.
- **The frontend sends only ids.** The server loads everything else, so a user cannot fake a profile or a balance. The only user text accepted is the rewrite instruction and the sent text.
- **Credits follow real cost.** A hard cost cap per user catches bugs; a system budget catches a bad day.
- **Caps live in Postgres, not Redis.** The ledger and `llm_usage` already hold the facts; Redis keeps only the hourly warning and the existing rate limits.
- **Refunds are idempotent in the database**, not only in code.
- **The post's apply instructions win** over the playbook ("DM only" makes the comment a short note, or empty).
- **Red flags go to the user, never into the prompt.**
- **Every send is kept** (`reply_sends`), and every AI draft too, so voice learning and later analytics have the full history (rule 3).
- **Rule 1 holds.** Nothing is sent from the user's account; "Open post" and the send are the user's.

## Known gaps and deferred items

- **No live Vertex run.** `report.json` is a **stub run** (`"stub": true`, 50 scored, validators 100%, judge means 4). It satisfies the guard test, but says nothing about real quality. Run `eval:drafts` live, then replace it. The playbook, the judge prompt and the voice prompt are untested against a real model.
- **Flash-Lite and Flash prices are unverified** (see Cost). Confirm them on the official Vertex page before launch.
- **All 50 eval cases are hand-written.** The dev database had no posts. After the ingestion soak run, use `eval:export-cases` to swap in real posts.
- **L6: the plan is stored twice** (`profiles.plan` and `credit_balances.plan`). Unify them when payments are built.
- **No reminders or follow-ups.** They wait for the email system. `replies.remind_at` exists but nothing sets or reads it.
- **No UI.** The API exists; nothing in the web app calls it.
- **No monthly credit grant.** Only the trial grant (in `finishOnboarding`) and the dev script exist. The trigger for paid plans waits for payments.
- **Version-number gap.** If v2 fails while v3 already exists (two rewrites at once), the numbering has a hole. Failed rows do not count toward the 5 versions.
- **The voice stale requeue has no attempt limit.** A voice row stuck in `running` is requeued every time. Non-provider failures go back to `idle` and the next send queues again.
- **Number checks are loose.** "40%" passes if a "40" appears anywhere in the evidence or post. A false positive can still happen only if a tool name is not in the taxonomy (for example a `Socket.io`-style name would look like a bare domain).
- **A provider outage does not use up attempts**, so a draft can stay pending through a long outage (the circuit breaker slows it, and the 10-minute expiry then fails and refunds it).
- **A refund made after a new grant lands in the new period.** The user keeps the credits, which is the safe side.
- **The admin screens for the eval queue and the library** are scripts for now.
- **Deployment:** run migrations `0012` to `0014` and `syncReferenceData()` before the new worker and web build take traffic (the draft examples table and the new analysis column must exist). The worker needs Vertex access, as for matching.

## Tests

`npm test` never calls Reddit or Vertex: the model is stubbed (`createFakeTransport` or `apps/worker/test/stub-llm.ts`).

| Area | Where |
|---|---|
| Plans, evidence, validators, voice maths, text helpers, examples | `packages/core/src/drafts/*.test.ts` (core: 282 in all) |
| Schema constraints, credits (concurrent reserve, refund once), queue (claim, fence, stale, expire), voice storage, reference sync | `packages/db/src/credits.test.ts`, `draft-jobs.test.ts`, `draft-queue.test.ts`, `drafts-schema.test.ts`, `drafts.test.ts`, `voice.test.ts`, `reference.test.ts` (db: 291) |
| Prompt, generate, drafter loop, voice job, analysis | `apps/worker/src/drafts/*.test.ts`, `ingest/analyser.test.ts`, eval tests in `apps/worker/test/eval/drafts/` (worker: 562) |
| Routes and server code | `apps/web/src/app/api/v1/drafts/drafts.test.ts`, `replies/replies.test.ts`, `apps/web/test/draft-fixtures.ts` (web: 377) |

Totals on 2026-10-20: web 377, worker 562, core 282, db 291, llm 26 = **1,538** (1,124 on `main`). The riskiest parts (the credit reserve, the refund, the version fence) were checked by breaking them on purpose: a test fails each time. Seven existing test files now truncate with `cascade`, because new tables reference `job_posts` and `matches`. The tests can use separate databases through `TEST_DATABASE_URL` (db, worker) and `WEB_TEST_DATABASE_URL` (web); the defaults are unchanged.
