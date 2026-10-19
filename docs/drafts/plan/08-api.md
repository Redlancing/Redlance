# Phase 8: The API routes and the trial grant

Model: **Sonnet** · Runs after Phase 7

## Why

These routes are what the UI will call later. The browser sends only ids and the user's own text. The server checks ownership, the plan and the limits, then hands the work to the worker queue.

## Files

Every route uses `apiRoute()` (`apps/web/src/server/api-route.ts`), with zod input/params, and returns `json(status, body)`. Copy the shape of `apps/web/src/app/api/v1/feed/[matchId]/status/route.ts`. Each route gets a colocated `*.test.ts`, using `apps/web/test/helpers.ts` (`resetState`, `cookieFor`, `req`).

### `apps/web/src/server/errors.ts`

Add to the `ErrorCode` union and the `STATUS` map:
- `INSUFFICIENT_CREDITS` 402;
- `DAILY_LIMIT` 429;
- `PLAN_EXPIRED` 403;
- `MAX_VERSIONS` 409;
- `DRAFT_NOT_READY` 409.

### `apps/web/src/server/drafts.ts` (new, server-only)

- `startDraft(user, { matchId, idempotencyKey })`:
  1. load the plan; `aiAllowed(plan, trialEndsAt, now)` from `packages/core/src/matching/plans.ts`, else `PLAN_EXPIRED`;
  2. check the match is the user's and not withdrawn, else `NOT_FOUND`;
  3. if v1 exists → return it;
  4. `isDraftingPaused` → `UNAVAILABLE`;
  5. `createDraftJob` with `TASK_CREDITS.draft`, mapping its errors to the codes above;
  6. the hourly warning (`countInWindow`) → `slowDown`.
- `startRewrite(user, draftId, { option | instruction, idempotencyKey })`:
  - the parent must be the user's and `done` (`DRAFT_NOT_READY`);
  - next version ≤ 5 (`MAX_VERSIONS`);
  - credits from `taskForRewrite(option)` (an instruction means `custom`);
  - a new row with the parent set.
- `getDraft(user, id)`: what the poll returns (README §14), with `evidenceSummary`, `applyInstructions` and `redFlags` from the stored evidence and analysis. It **never** returns the raw evidence text or the prompt.
- `listVersions(user, matchId)`.

### `apps/web/src/server/replies.ts` (new)

- `markSent(user, { draftId, kind, sentText })`:
  - the draft must be the user's and done;
  - compute `edit_ratio` against the draft's comment or DM (a Levenshtein-style distance ÷ the AI text length, capped at 1; put the helper in core next to the validators);
  - insert into `replies` (a conflict on (user, post, kind) → update the text and `sent_at`, so re-marking works);
  - set `matches.status = 'replied'`;
  - edit ratio > `HEAVY_EDIT_RATIO` → eval candidate `heavy_edit`;
  - call the Phase 9 hook `onReplySent` (a no-op stub until Phase 9).
- `updateReply(user, id, { status, agreedRateMinor?, currency? })`:
  - update `replies.status`;
  - insert an `outcomes` row (type = status, or `unpaid` from a separate flag);
  - the agreed rate only for `hired`.
- `listReplies(user, { status?, cursor? })`: newest first, cursor pagination as in the feed, joined with the post title, subreddit and URL.

### Routes (`apps/web/src/app/api/v1/`)

| File | Method |
|---|---|
| `drafts/route.ts` | POST (start), GET (`?matchId=` versions) |
| `drafts/[id]/route.ts` | GET (poll) |
| `drafts/[id]/rewrite/route.ts` | POST |
| `drafts/[id]/feedback/route.ts` | POST, upserting `draft_feedback` + eval candidate `thumbs_down` |
| `replies/route.ts` | POST (mark sent), GET (tracker) |
| `replies/[id]/route.ts` | PATCH |
| `credits/route.ts` | GET: `{ plan, balance, periodEnd, repliesLeft, usedToday, dailyCap }` |

Input limits come from core constants:
- `instruction` ≤ 200;
- `sentText` ≤ 10,000;
- `idempotencyKey` a uuid;
- the feedback `reason` ≤ 300.

### Trial grant

In `apps/web/src/server/onboarding/service.ts`, in `finishOnboarding`, call `grantPlanCredits(tx, userId, "trial", trialEndsAt, now)` **in the same transaction** that sets the trial. Update `docs/onboarding/conclusion.md` with one line about it.

## Test cases

| # | Case | Expect |
|---|---|---|
| 1 | POST /drafts without a session; with a wrong origin | 401; 403 |
| 2 | POST /drafts for another user's match | 404 |
| 3 | POST /drafts, trial expired | 403 `PLAN_EXPIRED` |
| 4 | POST /drafts happy path | 202 `{ draftId, status: "pending" }`; balance −7 |
| 5 | POST twice with the same idempotency key | the same draftId; balance −7 once |
| 6 | POST again with a new key after v1 exists | 200 with v1; no charge |
| 7 | Balance 6 | 402 `INSUFFICIENT_CREDITS` |
| 8 | Daily cap reached | 429 `DAILY_LIMIT` |
| 9 | Drafting paused (seed `llm_usage`) | 503 |
| 10 | The 11th draft in an hour | 202 with `slowDown: true` (not blocked) |
| 11 | GET /drafts/:id while pending; after the worker marks it done (call `completeDraft` directly) | `pending`; `done` with comment, dm, evidenceSummary, applyInstructions |
| 12 | GET another user's draft | 404 |
| 13 | GET response | contains no `evidenceText` and no prompt |
| 14 | Rewrite "shorter" | 202, v2, balance −1 |
| 15 | Rewrite "different_project" | balance −7 |
| 16 | Rewrite of a pending draft | 409 `DRAFT_NOT_READY` |
| 17 | The 5th rewrite (v6) | 409 `MAX_VERSIONS` |
| 18 | Instruction of 201 characters | 400 `INVALID_INPUT` |
| 19 | GET /drafts?matchId= | versions 1..n in order |
| 20 | POST /replies (dm) | 201; `matches.status = replied`; `edit_ratio` stored |
| 21 | POST /replies with sent text very different from the draft | eval candidate `heavy_edit` |
| 22 | POST /replies twice for the same kind | one row, updated text |
| 23 | PATCH /replies/:id `hired` with a rate | status hired; an outcome row with the rate |
| 24 | PATCH with a rate on `no_reply` | 400 |
| 25 | GET /replies?status=sent | only sent; cursor pagination works |
| 26 | POST feedback twice | one row; one eval candidate |
| 27 | GET /credits | balance, `repliesLeft` = floor(balance ÷ 7), usedToday |
| 28 | Finish onboarding | a `credit_balances` row of 210 ending at `trialEndsAt`; a grant ledger row |
| 29 | Finish onboarding fails after the grant | the grant is rolled back too (same transaction) |

## Done when

- All 29 cases pass and the whole repo is green.
- "## Phase 8: done" in `plan/build-notes.md`: a route table with sample request and response bodies (for the future UI work).
