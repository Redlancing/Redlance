# Phase 7: The draft queue in the worker

Model: **Opus** (queue + money) · Runs after Phase 6

## Why

This is where a pending draft row becomes a written draft:
1. claim it safely;
2. build the evidence;
3. call the AI;
4. check the result, retrying once if needed;
5. save it, or refund the credits.

It must survive crashes and restarts without double-charging or losing a draft, the same guarantees the analyser and re-scorer already give.

## Files

### `packages/db/src/drafts.ts` (extend)

- `claimNextDrafts(db, limit, now) → DraftClaim[]`:
  - `update drafts set status = 'running', locked_at = now(), attempts = attempts + 1 where id in (select id from drafts where status = 'pending' and run_after <= now() order by created_at for update skip locked limit $limit) returning …`;
  - `DraftClaim` includes `attempts`, used to fence later writes.
- `completeDraft(db, claim, result)`:
  - fenced on `status = 'running' and attempts = claim.attempts`;
  - saves comment, dm, the plan fields, evidence, style tags, warning, problems, model, prompt version, tokens, cost, timings, `finished_at`; sets `status = 'done'`;
  - returns false if the claim was lost.
- `failDraft(db, claim, { code, retryable, countAttempt })`:
  - retryable and under 3 attempts → back to pending with `run_after` = now + 2^attempts seconds;
  - otherwise `status = 'failed'`, plus **`refundCredits` in the same transaction**.
- `requeueStaleDrafts(db, olderThanSec = 60)`: running rows with old `locked_at` go back to pending.
- `addEvalCandidate(db, draftId, reason)`: insert, doing nothing on conflict.

### `apps/worker/src/drafts/generate.ts` (new)

`generateDraft(ctx, deps) → { output, problems, warning, attempts, model }`:
1. Pick the model:
   - the first draft and `different_project` → `deps.draftModel`;
   - other rewrites → `deps.rewriteModel`.
2. `generateStructured` with `draftOutputSchema`, temperature 0.7, thinking `"off"`, `maxOutputTokens` 800, `timeoutMs` 15 s, `retries` 1.
3. `validateDraft`. Problems:
   - **one** more call, with `formatProblemsForRetry` added;
   - for a Flash-Lite rewrite, that retry uses `draftModel`.
4. Still failing → return with `warning = true` and the problems.
5. Every attempt goes through `onAttempt` → `recordLlmUsage` with:
   - `task`: `draft` or `rewrite`;
   - `step`: `generate` or `retry`;
   - `prompt_version`, `user_id`, `job_post_id`, cost;
   - **never any text.**

### `apps/worker/src/drafts/drafter.ts` (new)

`createDrafter(deps) → { start, stop, idle }`. Copy the structure of `apps/worker/src/ingest/analyser.ts`:
- listener on channel `drafts` (`createPgListener`), a poll every 5 s and a stale sweep every 60 s;
- `concurrency` from env (default 4);
- the circuit breaker: 3 provider failures in a row → pause 1 min × 2^n, max 15 min;
- **the system budget:** `isDraftingPaused` → stop claiming and log a warning once a day; `shouldAlert` → an error log once a day.

Per claim:
1. `loadDraftContext`. Null (match deleted or withdrawn) → `failDraft` with code `MATCH_GONE`, not retryable → refund.
2. **Evidence:**
   - v1 → `buildEvidence`;
   - a rewrite → copy the parent's evidence, except `different_project` → `buildEvidence` with `exclude.projectIds` = the projects cited in all earlier versions;
   - no other project available → `failDraft` with code `NO_OTHER_PROJECT` → refund.
3. `pickExamples(jobType)`.
4. Load the voice profile (Phase 9 fills it; empty until then).
5. `buildDraftPrompt` → `generateDraft`.
6. `completeDraft`. A lost claim → log only.
7. `warning` → `addEvalCandidate(validator_failed_twice)`.
8. A rewrite whose version is ≥ 4 (the 3rd rewrite) → `addEvalCandidate(many_rewrites)`.
9. **Failures:**
   - provider errors (rate limited, quota, server) → `failDraft` with `countAttempt: false`, back to pending;
   - timeout or invalid output after the LLM's own retry → counts;
   - after 3 attempts → failed + refund;
   - abort on shutdown → back to pending without counting;
   - log codes only.
10. Per-draft timeout: 40 s, via an AbortController linked to `stop`.
11. Timings: record ms for load, evidence, ai, validate and save in `timings`.

### `apps/worker/src/env.ts`

- `DRAFTS_ENABLED` (default true);
- `DRAFT_MODEL` (default = `VERTEX_MODEL_SMART`) and `REWRITE_MODEL` (default = `VERTEX_MODEL_FAST`);
- `DRAFT_CONCURRENCY` (1–16, default 4);
- `DRAFT_BUDGET_ALERT_USD` and `DRAFT_BUDGET_PAUSE_USD` (from Phase 5).

### `apps/worker/src/index.ts`

- Start and stop the drafter when `DRAFTS_ENABLED`.
- If a model has no price entry, log an error at start (the budget can't work without one).

### `apps/worker/test/stub-llm.ts`

Answer the `Task: draft` prompts deterministically:
- a 2-sentence comment;
- an ~80-word DM using the evidence's link and its first skill;
- for prompts containing a marker `STUB_INVENT`, a DM with "60%", to test the retry.

## Test cases

`apps/worker/src/drafts/generate.test.ts` (fake transport):

| # | Case | Expect |
|---|---|---|
| 1 | A valid first answer | one attempt; no problems; `model` = draftModel |
| 2 | The first answer invents "60%", the second is clean | 2 attempts; no warning; the retry prompt mentions 60% |
| 3 | Both answers invalid | warning true; the problems returned |
| 4 | A style rewrite | uses rewriteModel |
| 5 | A style rewrite fails validation | the retry uses draftModel |
| 6 | Every attempt | recorded through `onAttempt` with the task and step; no text in the record |

`apps/worker/src/drafts/drafter.test.ts` (test database + stub LLM; seed with Phase 5's `createDraftJob`):

| # | Case | Expect |
|---|---|---|
| 7 | A pending v1 | done; comment and dm saved; evidence saved; `llm_usage` row; credits stay reserved |
| 8 | A rewrite "shorter" of v1 | v2 done; evidence equal to v1's; parent set |
| 9 | "Different project" with 2 projects | v2 cites the other project |
| 10 | "Different project" with 1 project | failed `NO_OTHER_PROJECT`; credits refunded |
| 11 | The match was withdrawn before the claim | failed `MATCH_GONE`; refunded |
| 12 | The stub throws `rate_limited` | back to pending; attempts not counted; no refund yet |
| 13 | Invalid output 3 claims in a row | failed; refunded **once** (one refund row) |
| 14 | Validator fails twice | done with warning; eval candidate `validator_failed_twice` |
| 15 | The 3rd rewrite on a post | eval candidate `many_rewrites` |
| 16 | A stale running draft | requeued by the sweep, then done |
| 17 | `stop()` mid-call | aborted; back to pending; resolves within the grace period |
| 18 | Two drafters on the same queue, 10 pending | each processed exactly once |
| 19 | System budget at pause (seed `llm_usage`) | nothing claimed; a warning logged once |
| 20 | NOTIFY wakes the drafter | done within 1 s without waiting for the poll |
| 21 | Env defaults and bounds | as specified |

## Done when

- All 21 cases pass (the concurrency case 5 times in a row) and the whole repo is green.
- "## Phase 7: done" in `plan/build-notes.md`: the error codes, the attempt and backoff rules, and the measured time per stub draft.
