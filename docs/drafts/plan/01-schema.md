# Phase 1: Tables, migration and core constants

Model: **Sonnet** · Runs first

## Why

Every later phase reads or writes these tables and constants. Getting the constraints right here (versions 1–5, a balance that can't go below 0, one reply per kind) means the database itself enforces the rules, not just the code.

## Files

### `packages/core/src/drafts/plans.ts` (new, pure)

- `DRAFT_TASKS = ["draft", "rewrite_flash", "rewrite_lite"] as const`.
- `TASK_CREDITS = { draft: 7, rewrite_flash: 7, rewrite_lite: 1 }`.
- `REWRITE_OPTIONS = ["shorter", "casual", "formal", "different_project", "custom"] as const`.
- `taskForRewrite(option) → "rewrite_flash" | "rewrite_lite"`: `different_project` → `rewrite_flash`; everything else → `rewrite_lite`.
- `PLAN_CREDITS = { trial: 210, standard: 2100, max: 5600 }`.
- `DAILY_CREDIT_CAP = { trial: 105, standard: 210, max: 560 }`.
- `DAILY_COST_CAP_MICROS = { trial: 200_000, standard: 400_000, max: 1_000_000 }`.
- `MAX_VERSIONS = 5`, `INSTRUCTION_MAX = 200`, `SENT_TEXT_MAX = 10_000`, `HOURLY_WARNING = 10`.
- `VOICE_FIRST_AFTER = 3`, `VOICE_EVERY = 5`, `VOICE_SAME_OPTION_STREAK = 3`, `VOICE_MAX_PER_DAY = 2`.
- `HEAVY_EDIT_RATIO = 0.6`.
- `repliesLeft(balance) → Math.floor(balance / TASK_CREDITS.draft)`.
- A short comment explaining the pricing rule: credits per task = its cost ÷ $0.0007, rounded.

### `packages/core/src/drafts/types.ts` (new)

- `DRAFT_STATUSES = ["pending", "running", "done", "failed"]`.
- `DRAFT_KINDS = ["draft", "rewrite"]`.
- `REPLY_KINDS = ["comment", "dm"]`.
- `REPLY_STATUSES = ["sent", "replied", "hired", "lost", "no_reply", "ghosted"]`.
- `OUTCOME_TYPES = ["replied", "hired", "lost", "no_reply", "ghosted", "unpaid"]`.
- `LEDGER_REASONS = ["grant", "reserve", "refund", "expire", "adjust"]`.
- `EVAL_CANDIDATE_REASONS = ["validator_failed_twice", "heavy_edit", "many_rewrites", "thumbs_down"]`.
- `EVAL_REVIEW_STATUSES = ["pending", "added", "skipped"]`.
- `VOICE_UPDATE_STATUSES = ["idle", "pending", "running"]`.
- `EXAMPLE_SOURCES = ["handwritten", "winning"]`.
- Types for: `Evidence` (shape only; filled in Phase 3), `DraftPlan { problem, citedFact, applyInstructions }`, `DraftOutput`, `Problem { code, detail? }`, `VoiceStats`.

### `packages/core/src/drafts/index.ts` (new)

Re-exports the above. Add `export * from "./drafts"` to `packages/core/src/index.ts`.

### `packages/db/src/schema.ts`

Tables exactly as in README §13. Follow the existing patterns:
- `v7Id()`, `createdAt()`, `userId()` (cascade);
- enums as literal lists + `check("<table>_<col>_check", sql\`... in (${sqlList(X)})\`)`;
- `jsonb().$type<...>()`. The schema file doesn't import core, so the literal lists are copied here.

Constraints:
- `drafts`: `version between 1 and 5`; unique (`user_id`, `match_id`, `version`); unique (`user_id`, `idempotency_key`) where the key is not null; `instruction` ≤ 200 characters; `credits >= 0`; FK `match_id` → `matches` (cascade), FK `parent_id` → `drafts` (set null), FK `job_post_id` → `job_posts`.
- Index on `drafts (status, run_after)` where status in (pending, running), for claims.
- Index on `drafts (user_id, created_at)`.
- `credit_balances`: `balance >= 0`.
- `credit_ledger`: index (`user_id`, `created_at`); FK `draft_id` set null.
- `replies`: unique (`user_id`, `job_post_id`, `kind`); `sent_text` ≤ 10,000 characters; index (`user_id`, `status`, `sent_at`).
- `outcomes`: FK `reply_id` cascade; `agreed_rate_minor >= 0` when set.
- `voice_profiles`: `notes` ≤ 600 characters; `cardinality(best_reply_ids) <= 2`.
- `draft_examples`: text primary key (a stable id like `webdev-dm-1`).
- `draft_eval_candidates`: unique (`draft_id`, `reason`).
- `draft_feedback`: unique (`user_id`, `draft_id`).
- `job_post_analyses.apply_instructions`: text, nullable, ≤ 300 characters.

### Migration

`npm run db:generate`, then rename the file to `packages/db/migrations/0012_drafts.sql` (and update `meta/_journal.json` to match, as earlier migrations did). Then `npm run db:migrate`.

### `packages/db/src/schema-lists.test.ts` (or extend the existing lists test)

Assert that each literal list in `schema.ts` equals the core list (the existing pattern for other enums).

## Test cases

`packages/core/src/drafts/plans.test.ts`:

| # | Case | Expect |
|---|---|---|
| 1 | `taskForRewrite("different_project")` | `rewrite_flash` |
| 2 | `taskForRewrite` for shorter / casual / formal / custom | `rewrite_lite` |
| 3 | `repliesLeft(2100)`, `repliesLeft(6)` | 300, 0 |
| 4 | Every plan in `PLANS` has entries in `PLAN_CREDITS`, `DAILY_CREDIT_CAP` and `DAILY_COST_CAP_MICROS` | true |
| 5 | Daily cap ≤ plan credits for every plan | true |

`packages/db` schema tests (a real test database):

| # | Case | Expect |
|---|---|---|
| 6 | Insert a draft with version 6 | check violation |
| 7 | Two drafts with the same (user, match, version) | unique violation |
| 8 | Two drafts with the same idempotency key for one user; null keys twice | violation; nulls allowed |
| 9 | Instruction of 201 characters | check violation |
| 10 | `credit_balances.balance = -1` | check violation |
| 11 | Two replies with the same (user, post, kind); comment + dm on one post | violation; allowed |
| 12 | `voice_profiles.notes` of 601 characters; 3 best reply ids | violations |
| 13 | Delete a user | their drafts, credits, replies, outcomes, voice profile and feedback are deleted (cascade) |
| 14 | Delete a match | its drafts are deleted; a reply's `draft_id` becomes null (set null) |
| 15 | Unknown status / kind / reason values on each table | check violations |
| 16 | The literal lists in `schema.ts` | equal to the core lists |
| 17 | `apply_instructions` of 301 characters | check violation |

## Done when

- All 17 cases pass; the migration applies cleanly to an empty database and to the dev database.
- `npm test`, typecheck and lint are green.
- "## Phase 1: done" in `plan/build-notes.md`: the table names, any constraint added or changed, and the migration file name.
