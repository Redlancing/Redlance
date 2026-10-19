
## Phase 1: done

- **Migration:** `packages/db/migrations/0012_drafts.sql` (generated, renamed, journal and snapshot kept; applied to the dev database and, through `runMigrations`, to the test database).
- **New tables:** `drafts`, `credit_balances`, `credit_ledger`, `replies`, `outcomes`, `voice_profiles`, `draft_examples`, `draft_eval_candidates`, `draft_feedback`; new column `job_post_analyses.apply_instructions` (check <= 300).
- **Core:** `packages/core/src/drafts/{plans,types,index}.ts`, exported from `packages/core/src/index.ts`. `Evidence` and `VoiceStats` are `Record<string, unknown>` for now; Phase 3 narrows `Evidence`.
- **Schema literal lists** (in `schema.ts`, named `*_VALUES`): checked against core in `packages/db/src/drafts-schema.test.ts`.
- **Constraints added or changed vs the spec:**
  - `replies.match_id` is nullable with `on delete set null` (a sent reply is history and must survive its match being deleted); `replies.job_post_id` and `drafts.job_post_id` are plain FKs to `job_posts` (no cascade; posts are never deleted).
  - Check constraints added for every enum column (drafts kind/option/status, replies kind/status, outcomes type, ledger reason, balance plan, voice update_status, examples channel/source, candidates reason/review_status) and `draft_feedback.reason <= 300`.
  - `drafts` idempotency uniqueness is a partial unique index (`drafts_user_idempotency_idx`, where key is not null); the other uniques are constraints.
  - Extra indexes: `outcomes (reply_id)`, `voice_profiles (update_status, update_run_after)` where not idle.
  - `credit_balances.plan` uses `PLANS`; `draft_examples.job_type` is free text (a taxonomy job type id or `general`), not a check.
  - `drafts.credits` defaults 0; `version` is smallint.
- **Existing tests changed:** 7 test files truncate `job_posts`/`matches` without `cascade`, which fails once other tables reference them; each statement now ends in `cascade` (rescorer, matcher, analyser, collector, ingest, matches, match-stats tests).
- **Tests:** new `packages/core/src/drafts/plans.test.ts` (5 cases) and `packages/db/src/drafts-schema.test.ts` (16 tests covering cases 6-17). Totals: web 299, worker 436, core 178, db 206, llm 26 = 1,145 (was 1,124).
- Prettier still flags `packages/core/src/matching/score.test.ts` and `packages/db/src/db.test.ts`; both were already unformatted before this phase.

## Wave 2 setup (main session)

- **Parallel build:** phases 2, 3, 4, 5, 6, the pure part of 9 and the cases part of 10 ran at once. Each agent ran its own test database (`redlance_test_a`…`_g`, created by hand). `TEST_DATABASE_URL` in `packages/db/vitest.config.ts` and `apps/worker/vitest.config.ts` is now overridable, and the web tests read `WEB_TEST_DATABASE_URL` (`apps/web/test/test-env.ts`). Defaults are unchanged.
- **Fixed before the wave:** `Evidence` (+ `EvidenceProject`, `EvidenceRole`, `RateNote`) and `VoiceStats` are concrete in `types.ts`; `DraftPlan.applyInstructions` is `string | null`. Shared helpers written once: `banned.ts` (`BANNED_PHRASES`) and `text.ts` (`normalise`, `wordCount`, `sentenceCount`, `editRatio` = word-level edit distance ÷ AI words, capped at 1), with `text.test.ts`.
- `createDraftJob` lives in `packages/db/src/draft-jobs.ts` (not `drafts.ts`, which Phase 3 owned); Phase 7 adds the queue functions there.

## Phase 2: done

- `PIPELINE_VERSION = "post@3"`, `PROMPT_VERSION = "post-extract@3"`.
- Output gains `applyInstructions` (≤ 300, nullable) + `quote` (≤ 200). `checkApplyInstructions(value, quote, text)` keeps it only when the quote is in the post (case-insensitive, whitespace collapsed); kept only for `kind = hiring`.
- The feed (`FeedItem.post.applyInstructions`, `/api/v1/feed`) returns it.
- Tests went into `analyser.test.ts` (there is no `analyse-post.test.ts`). The posts eval fixtures are unchanged (nullable column). No live Vertex run.

## Phase 3: done

- `buildEvidence`, `rankProjects`, `rankRoles` in `packages/core/src/drafts/evidence.ts`; `loadDraftContext` in `packages/db/src/drafts.ts` (one join + 4 parallel queries; needs the db handle, not a transaction).
- Ranking weights: post skill the user has as core 3, other post skill 1, shared category 2, shared domain 1 (domains found by whole-word match on the title + summary). Ties: latest year, then position (roles: current, latest end, position).
- **Deviations:** a project or role is picked from the ranking only with score > 0 (an unrelated project isn't cited), but an explicit `match.bestProjectId` is used anyway. There's no `portfolio_only` pay type, so only `unpaid` becomes a red flag (proposed: also `commission_only` and `revshare`, for the review). `EvidenceInput.now` is optional, for the 7-day rule. The 3,000-character body cap is applied in the prompt, not the loader.
- Employer names are scrubbed from project and role text using the names of every role, so a name in an unchosen role is caught too.

## Phase 4: done

- `validateDraft`, `lengthTarget`, `formatProblemsForRetry`, `findUrls`, `findNumbers` in `validate.ts`.
- **Tightened:** a blank DM with a comment → `DM_TOO_SHORT`. **Loosened:** digits inside URLs aren't number claims.
- A number counts as a claim with a currency sign, `%`, `k`/`m`/`x`, a decimal, a value above 10, or "years/yrs/clients" after it. Claims are matched by value against every number in the evidence, the post and the instruction (so "40%" passes if "40" is anywhere: loose, noted for the review).

## Phase 5: done

- Migration `0013_credit_refund_once.sql`: unique `credit_ledger (draft_id) where reason = 'refund'`, plus `llm_usage (user_id, created_at)` (the per-user daily cost check runs on every draft request).
- `credits.ts`: `grantCredits`, `grantPlanCredits`, `reserveCredits`, `refundCredits` (refund-once), `creditsUsedToday`, `costTodayMicros`, `systemDraftCostTodayMicros`, `getCredits`, `draftBudget`, `isDraftingPaused`, `onceADay`, `DRAFT_COST_TASKS` (draft, rewrite, voice).
- `createDraftJob` returns `{ draft, created } | { error }`. It checks an existing draft (same key or same user/match/version) before the caps, so a repeat returns the draft even at the cap.
- **Concurrency:** every money transaction locks the user's `credit_balances` row first; the reserve is a guarded `UPDATE … balance >= amount`. A test without the lock let 20 drafts through instead of 15.
- `countInWindow` (one Lua call: INCR + EXPIRE, fails open) and `hourlyDraftWarning` in the web rate limiter. Env `DRAFT_BUDGET_ALERT_USD` / `DRAFT_BUDGET_PAUSE_USD` in web + worker. `npm run credits:grant -w @redlance/worker` (local/test only).
- Known edges: a refund made after a new grant lands in the new period; an idempotency key reused for another match returns the first draft (Phase 8 rejects it).

## Phase 6: done

- `DRAFT_PROMPT_VERSION = "draft@1"`. `DRAFT_SYSTEM`, `buildDraftPrompt`, `draftOutputSchema`, `styleTags` in `apps/worker/src/drafts/prompt.ts`; `DRAFT_EXAMPLES` (16: 3 each for development, video, design, writing; 4 general) in `packages/core/src/drafts/examples.ts`; the `draft_examples` sync and `pickExamples` in `packages/db/src/reference.ts`.
- Prompt order: system → `<examples>` → `<voice>` → `<post>` → `<apply>` → `<evidence>` → rewrite/retry → task line with the DM word range. Fixed part ≈ 1,400 tokens, variable ≈ 300.
- Outside text has `<` and `>` replaced with look-alike characters (not deleted). Pay type and red flags never enter the prompt. Employer names are scrubbed again over voice, evidence and previous-draft lines.
- Examples quote no prices of their own (the rate note has no number); the two rate examples show "the posted budget works" and "I can send a quote".
- The sync never touches `source = 'winning'` rows. `prompt.ts` has its own `{link}` constant (keep it in step with `examples.ts`).

## Phase 9 (pure part): done

- `measureSend`, `updateStats`, `statsToTargets`, `shouldUpdateVoice`, `pickBestSends` in `packages/core/src/drafts/voice.ts` (cases 1–11). `SendMeasure` adds `linkPosition` (needed for `avgLinkPosition`). The db, job and hook-up parts follow in wave 4.

## Phase 10 (cases part): done

- 40 draft cases + 10 rewrite cases in `apps/worker/test/eval/drafts/cases/`, 5 profiles, `cases.ts` loader (guard case 4) and `export-cases.ts` (`npm run eval:export-cases`). All hand-written: the dev database had no posts. Swap in real posts after the ingestion soak run.
- Cases carry `tags` (an addition) so the coverage counts are explicit.

## Wave 2 check

- Full suite: web 309, worker 481, core 266, db 252, llm 26 = **1,334** passing. Typecheck and lint clean.
- Drizzle's migration meta JSON isn't prettier-formatted (it never was on `main`); left as generated.

## Phase 7: done

- Queue functions in `packages/db/src/draft-jobs.ts`: `claimNextDrafts` (FOR UPDATE SKIP LOCKED; database clock by default), `completeDraft` and `failDraft` (fenced on `status = running AND attempts = claim.attempts`), `requeueStaleDrafts` (60 s; on attempt 3 → `failed` code `STALE` + refund), `addEvalCandidate`, `draftVersions` (addition). `MAX_DRAFT_ATTEMPTS = 3`; retry backoff 2^attempts s.
- `failDraft` locks the balance row first (same order as `createDraftJob`), then the fenced update, then `refundCredits` only if the row became `failed`. A second call returns `"lost"`; the refund-once index is a second guard.
- `generateDraft` (`apps/worker/src/drafts/generate.ts`): temperature 0.7, thinking off, 800 tokens, 15 s, retries 1; usage rows carry no text. `createDrafter` (`drafter.ts`): listener on `drafts`, 5 s poll, 60 s sweep, circuit breaker, 40 s per-draft abort, budget pause/alert once a day. Env: `DRAFTS_ENABLED`, `DRAFT_MODEL`, `REWRITE_MODEL`, `DRAFT_CONCURRENCY` (default 4).
- **Deviations:** if the validator retry throws, the first answer is kept with a warning. `save` timing is only logged. New stop codes `PARENT_GONE`, `NO_OTHER_PROJECT` (+ `MATCH_GONE`). A rewrite with no option or instruction is treated as `shorter`. Logs carry `pgCode`/`errName`, not messages.
- **Known:** a provider outage doesn't use up attempts, so a draft can stay pending through a long outage (the breaker slows it). Pending drafts wait while the budget is paused.

## Phase 8: done

- Routes: `POST/GET /drafts`, `GET /drafts/:id`, `POST /drafts/:id/rewrite`, `POST /drafts/:id/feedback`, `POST/GET /replies`, `PATCH /replies/:id`, `GET /credits`. Server code in `apps/web/src/server/drafts.ts` and `replies.ts`.
- New error codes: `INSUFFICIENT_CREDITS` 402, `DAILY_LIMIT` 429, `PLAN_EXPIRED` 403, `MAX_VERSIONS` 409, `DRAFT_NOT_READY` 409, plus `IDEMPOTENCY_CONFLICT` 409 (key reused for another match or parent) and `VERSION_CONFLICT` 409 (a rewrite race).
- The draft view returns problem **codes only** (details can quote the post); never `evidenceText`, the prompt, or the plan fields. `comment`/`dm` are null until done.
- Trial grant: `grantPlanCredits(tx, …, "trial", trialEndsAt)` inside `finishOnboarding`'s transaction.
- Replies: re-marking keeps the status; heavy edit (> 0.6) → `heavy_edit` candidate; edit ratio null when the AI text is empty; `matches.status = replied` + a `match_events` row in the same transaction. PATCH `unpaid` adds an extra `unpaid` outcome row next to the status row. `remind_at` isn't set (reminders deferred).

## Wave 3 check

- Full suite: web 362, worker 513, core 266, db 270, llm 26 = **1,437** passing. Typecheck and lint clean.

## Phase 9 (rest): done

- `packages/db/src/voice.ts`: `recordSend` (one transaction: upsert + lock the row, fold stats, queue + `pg_notify('voice')` when `shouldUpdateVoice`), `claimVoiceUpdates`, `completeVoiceUpdate`, `failVoiceUpdate`, `requeueStaleVoiceUpdates` (120 s), `loadVoice`, `loadVoicePairs`, `loadOrganisations`.
- `apps/worker/src/drafts/voice-job.ts`: `createVoiceUpdater` (listener `voice`, 15 s poll, 60 s sweep, concurrency 2), `createVoiceLoader` (plugged into `createDrafterFromEnv`), `VOICE_SYSTEM`, `VOICE_PROMPT_VERSION = "voice@1"`. Flash-Lite (`REWRITE_MODEL`), temperature 0.3, 250 tokens. Inputs scrubbed (employers → description, URLs → `[link]`, angle brackets replaced, 1,200 characters each); `cleanNotes` scrubs the output again and cuts at 600.
- `markSent` calls `measureSend` + `recordSend` after commit, inside try/catch; counted only for a new reply with AI text. Env `VOICE_ENABLED` (default true).
- **Deviations:** fencing on `update_locked_at` (no attempts column); non-provider failures go idle (the next send queues again); a stale row is requeued with no attempt limit. The same-option trigger counts only style rewrites. Voice calls ignore the drafting budget pause and cost no credits (≤ 2 per user per day).

## Phase 10 (rest): done

- `npm run eval:drafts -w @redlance/worker -- [--model] [--judge-model] [--baseline] [--stub] [--cost-limit 3]`; `eval:candidates [--add|--skip]`; `eval:winners [--promote]`.
- `judge.ts` (`judge@1`): specific, followsInstructions, soundsHuman, citedWorkFits (1–5), invented (yes + quote), `expect` checks. `--baseline` prints cases that got worse.
- `report.json` is a **stub run** (`"stub": true`): 50 scored, validators 100%, judge means 4. Replace it with the first live run. `guard.test.ts` fails when `DRAFT_PROMPT_VERSION` changes (plus 2b: every case id is in the report).
- Winners: DM, edit ratio ≤ 0.3, replied/hired, ≥ 20 words; employers, display name, GitHub username, `u/` names, emails and phone numbers removed, URLs → `{link}`; id `winning-<replyId>`. **To fix in review:** the check runs against empty evidence, so a winner with a backed number ("40%") is refused; check against the draft's stored evidence instead.

## Wave 4 check

- Full suite: web 364, worker 553, core 266, db 283, llm 26 = **1,492** passing (1,124 on `main`). Typecheck and lint clean.

## Phase 11: review and fixes

Fresh Opus review: 1 high, 5 medium, 9 low. Money, ownership, prompt tags and log hygiene were found sound. All fixed with a test that failed first, except L6 (deferred).

- **Migration `0014_failed_versions_reply_sends.sql`:** (user, match, version) uniqueness is now a partial index `where status <> 'failed'`; new append-only `reply_sends` (backfilled from `replies`).
- **H1:** a failed v1 no longer blocks the match; failed rows don't take a version number or count toward `MAX_VERSIONS`. `GET /drafts?matchId=` hides failed versions; `GET /drafts/:id` still shows the failure. Gap left: if v2 fails while v3 exists, numbering has a hole (needs two rewrites at once).
- **M1:** `loadDraftContext` returns `allOrganisations` (hidden roles included), used only for scrubbing and `organisationNames`.
- **M2:** every rewrite rebuilds evidence from the current profile (`packages/db/src/draft-evidence.ts`), pinning the parent's project/role while visible; a now-hidden project's title and link are stripped from `<previous>`.
- **M3:** every send is kept in `reply_sends`; `replies` holds the latest.
- **M4:** `expireStuckDrafts` (`DRAFT_EXPIRE_AFTER_SEC = 600`): pending/running drafts older than 10 min → failed `EXPIRED` + one refund. Called by the drafter sweep and by the web for one draft (start and poll), so a stopped worker can't hold credits.
- **M5:** `findUrls` catches bare domains (`LINK_TLDS`, `LINK_TLDS_NEED_PATH`), skipping tool names from the taxonomy ("ASP.NET", "Make.com", "Socket.io") when they have no path.
- **Lows:** red flags via `draftRedFlags` (adds `commission_only`, `revshare`), same pending and done; rewrite pre-checks `MATCH_WITHDRAWN` / `NO_OTHER_PROJECT` (409, no charge); `creditsUsedToday` counts only refunds of same-day reserves; one `unpaid` outcome per reply; `created` from `xmax = 0`; `DraftDeadline` during the retry keeps the first answer; cross-user rewrite test. Best sends' URLs → `[link]` in `<voice>`.
- **Winners:** backed numbers → `{number}`, cited project/role → `{project}`, post budgets masked; unbacked numbers still refused. The system prompt says placeholders in examples stand for real values.
- **Deferred:** L6, the plan is stored in `profiles.plan` and `credit_balances.plan`; unify with payments.

## Final check

- Full suite: web 377, worker 562, core 282, db 291, llm 26 = **1,538** passing (1,124 on `main`). Typecheck, lint and `npm run build` clean.
