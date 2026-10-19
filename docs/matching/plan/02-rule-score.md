# Phase 2: candidates, filters, rule score and plans (pure code in core)

Model: **Sonnet** · Runs in parallel with Phase 1 · No database, no I/O

## Why

Every matching decision without AI happens here, as pure functions: who is a candidate, which pairs are filtered out, what the 0–100 rule score is, and which plans get AI. "Pure" means the same input always gives the same output. That makes it easy to test exhaustively and lets the worker (Phase 4) and the SQL (Phase 3) be checked against one source of truth.

## Files (all new, in `packages/core/src/matching/`, exported from `packages/core/src/index.ts`)

### `constants.ts`
```ts
export const RESCORE_THRESHOLD_DEFAULT = 50;   // rule score needed for AI (worker env can override)
export const BEST_MIN_SCORE = 60;              // the feed's "best" view
export const BROAD_CAP = 45;                   // safety cap; today's weights already keep broad ≤ 30
export const MATCH_MAX_AGE_DAYS = 7;
export const BACKFILL_DAYS = 3;                // a new user's feed
export const REMATCH_DAYS = 7;                 // after a profile change
export const MATCH_STATUSES = ["new", "seen", "saved", "dismissed", "replied"] as const;
export const AI_STATUSES = ["not_needed", "pending", "running", "done", "failed", "capped"] as const;   // broad matches are always not_needed
export const MATCH_EVENTS = MATCH_STATUSES;    // every status change is an event
```

### `plans.ts`
```ts
export const PLANS = ["trial", "standard", "max"] as const;    // agency: later
export const RESCORE_DAILY_CAP: Record<Plan, number> = { trial: 15, standard: 15, max: 50 };
/** May this user get AI re-scores right now? Paid plans always; trial only before it ends. */
export function aiAllowed(plan: Plan, trialEndsAt: Date, now: Date): boolean
```
Add a comment with the prices (Standard ≈ $8–10/month, Max $20/month), and that they are subscription prices set by hand until billing exists.

### `fx.ts`
```ts
/** Rough rates, for "is the budget above the user's minimum", not for money. Dated. */
export const FX_TO_USD: Record<"USD" | "GBP" | "EUR" | "INR", number>
export function convert(amount: number, from: string, to: string): number | null   // null if a currency is unknown
```

### `score.ts`

Input types are small, plain and independent of the db row types:
```ts
export type MatchPost = {
  postedAt: Date;
  kind: "hiring" | "for_hire" | "other";
  employmentType: "freelance" | "contract" | "part_time" | "full_time" | "unknown";
  payType: "paid" | "commission_only" | "revshare" | "unpaid" | "unknown";
  categories: string[];
  skillIds: string[];
  budgetMin: number | null; budgetMax: number | null;
  currency: string | null;
  budgetUnit: "fixed" | "hour" | "day" | "week" | "month" | "per_item" | null;
  remote: "remote" | "onsite" | "hybrid" | "unknown";
  deadline: string | null;          // YYYY-MM-DD
  redFlags: string[];
};
export type MatchProfile = {
  categories: string[];
  skills: { id: string; level: "core" | "secondary" }[];
  workSkillIds: string[];           // skills of VISIBLE projects and roles (hidden = false)
  minRateMinor: number;             // e.g. 3000 = 30.00
  currency: "USD" | "GBP" | "EUR" | "INR";
  rateType: "hourly" | "fixed" | "either";
  remoteOnly: boolean;
  includeUnpaid: boolean;
};
```

Functions:
- `isCandidate(post, profile): "skill" | "broad" | null`
  - `"skill"` when any post skill is in the profile's skills;
  - `"broad"` when the post has **no** skills and shares a category;
  - else `null`.
- `passesFilters(post, profile, now, maxAgeDays = MATCH_MAX_AGE_DAYS): boolean`. All must hold:
  - `kind === "hiring"`;
  - `employmentType !== "full_time"`;
  - `now − postedAt ≤ maxAgeDays`;
  - `deadline` is null or ≥ today (UTC date of `now`);
  - not (`remoteOnly` and `remote === "onsite"`);
  - `payType` is `paid` or `unknown`, **or** `includeUnpaid`.
  - Dismissed matches are a db concern, not here.
- `budgetFit(post, profile): "fits" | "below" | "unknown"`:
  - the amount is `budgetMax ?? budgetMin`; null, a missing currency, or a failed conversion → `unknown`;
  - convert to the profile's currency; `minRate = minRateMinor / 100`;
  - `hour`: compare with `minRate` when `rateType` is hourly or either;
  - `day`: compare with `minRate × 8` when `rateType` is hourly or either;
  - `fixed`: compare with `minRate` when `rateType` is fixed or either;
  - every other unit, or a rate type that doesn't apply → `unknown`;
  - `minRateMinor === 0` → `fits` whenever the amount is known.
- `ruleScore(post, profile): { score: number; broad: boolean; features: Feature[]; reason: string }`, where `Feature = { signal: string; points: number; detail?: string[] }`.

Weights, as an exported `WEIGHTS` const:

| Signal | Points |
|---|---|
| `core_skill` | +20 per post skill that's a core skill, max 60 |
| `secondary_skill` | +8 each, max 24 |
| `job_type` | +15 if any category is shared |
| `budget_fits` | +10 |
| `budget_below` | −25 |
| `work_overlap` | +10 if any post skill is in `workSkillIds` |
| `remote_fit` | +5 if `post.remote === "remote"` and `profile.remoteOnly` |
| `red_flag` | −15 each |

- **Broad** (`isCandidate === "broad"`): only `job_type`, budget, `remote_fit` and `red_flag` count, then `min(score, BROAD_CAP)`.
- Clamp to 0–100 and round to an integer.
- `features` lists only the non-zero signals, in table order.

### `reason.ts`

`ruleReason(features, skillName: (id) => string): string`. Short, ≤ 120 characters, joined with " · ". Examples:
- `"2 of your core skills (Next.js, Stripe) · budget fits · remote"`
- `"Broad match: shares your job type · budget below your minimum"`
- `"1 secondary skill (PostgreSQL) · red flag: upfront fee"`

Use skill names from the taxonomy (`SKILL_BY_ID`), never ids. List at most 3 skill names, then "+N". Red-flag text comes from a small map (e.g. `upfront_fee` → "upfront fee").

## Test cases

`packages/core/src/matching/score.test.ts`, `fx.test.ts`, `plans.test.ts` and `reason.test.ts`.

The fixed profile **Priya**:
- core: `nextjs`, `react`, `stripe`; secondary: `postgresql`;
- categories: `development`;
- min rate 3000 USD, `either`, remote only;
- workSkillIds: `nextjs`, `stripe`;
- includeUnpaid false.

Use real taxonomy ids; check that `postgresql` exists, and swap it for the right id if not.

| # | Case | Expect |
|---|---|---|
| 1 | Post A: skills `nextjs`, `stripe`; development; fixed $400 USD; remote; no flags | candidate `skill`; score **80** = 40 + 15 + 10 + 10 + 5; reason mentions Next.js and Stripe |
| 2 | Post B: skill `postgresql`; development; $25/hour; remote unknown | **0** (8 + 15 − 25 = −2 → clamped) |
| 3 | Post C: no skills; categories design, development; no budget; remote | candidate `broad`; score **20** (15 + 5); `broad: true` |
| 4 | Post D: video editing, no shared skill or category | `isCandidate` → null |
| 5 | 4 core skills shared | the core part caps at 60 |
| 6 | 4 secondary skills shared | the secondary part caps at 24 |
| 7 | Every signal maxed (3 core, 3 secondary, job type, fits, overlap, remote) | clamped to 100 |
| 8 | 2 red flags on post A | 80 − 30 = 50 |
| 9 | A broad match with a red flag | 20 − 15 = 5 |
| 10 | Broad: weights temporarily higher (pass custom weights if `ruleScore` accepts them, else test the clamp helper) | never above `BROAD_CAP` |
| 11 | Budget: $40/hour vs an hourly min of $30 | fits |
| 12 | Budget: $200/day vs an hourly min of $30 (240 needed) | below |
| 13 | Budget: fixed $400 vs an **hourly-only** user | unknown |
| 14 | Budget: hour vs a **fixed-only** user | unknown |
| 15 | Budget: week, month or per_item | unknown |
| 16 | Budget: missing currency, or no amounts | unknown |
| 17 | Budget: ₹2,000/hour (INR) vs a $30/hour USD user | converted with `FX_TO_USD`, below |
| 18 | Budget: `budgetMin` 20, `budgetMax` 50, hourly vs a $30 min | uses max, fits |
| 19 | Budget: `minRateMinor` 0 and any known amount | fits |
| 20 | Filters: `kind` for_hire / other | fails |
| 21 | Filters: full_time | fails; contract and part_time pass |
| 22 | Filters: 8 days old | fails; 6 days passes |
| 23 | Filters: deadline yesterday | fails; today passes; null passes |
| 24 | Filters: remote-only user and an onsite post | fails; hybrid and unknown pass |
| 25 | Filters: unpaid / commission_only / revshare | fail, pass with `includeUnpaid`; `unknown` pay passes |
| 26 | `aiAllowed` | trial before its end → true; trial after → false; standard and max → true even after the trial date |
| 27 | `RESCORE_DAILY_CAP` | 15 / 15 / 50 |
| 28 | `convert` | USD→USD identity; GBP→USD > 1×; unknown currency → null |
| 29 | `ruleReason` | ≤ 120 characters; skill names not ids; "+N" after 3 names; broad wording; red-flag wording |
| 30 | Determinism | the same input twice gives deep-equal output |

## Done when

- `@redlance/core` exports everything above, and all 30 cases pass.
- The whole repo is green.
- "## Phase 2: done" is in the handoff: exact export names, the type definitions, and any id swaps (e.g. the real PostgreSQL skill id).
