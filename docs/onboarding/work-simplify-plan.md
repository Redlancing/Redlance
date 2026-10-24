# Simpler projects and experience (work@3): plan

Date: 2026-10-23 · Status: **decisions only, not built.** Build only when the user says so. Read first: `conclusion.md` (onboarding) and `projects-experience-design.md`; the work call is `apps/worker/src/resume/steps/work.ts` (`work@2`).

Goal: an easier onboarding Work step and a cheaper, more reliable work call. Projects and experience come from one AI call, so they are changed together (one prompt version, one schema change, one migration, one UI update).

## Projects (agreed)

| Field | Decision |
|---|---|
| `title` | Keep (AI copies it; code checks it is in the project's lines). |
| `summary` (description) | Keep (AI writes one sentence). |
| `skills` | Keep (shortlist ids; code checks each label is in the lines). |
| `categories` | Keep (up to 2 job type ids). |
| `outcomes` | Keep, **AI-written** (see below). Shown in onboarding as pre-filled, editable text. |
| `role`, `kind` | **Drop.** Drafts and matching don't use them. |
| `domains` | **Drop.** Only a rank weight of 1 when drafts pick a project; skills (3) and categories (2) do the work. |
| `links` | **Drop completely:** no link detection at import (`projectLinks` in `apps/worker/src/resume/prepass.ts`), no link field on projects, no link toggle. Drafts then link only the GitHub profile (`packages/core/src/drafts/evidence.ts`, the `githubUsername` fallback). |
| `year` | **Drop** (user decision 2026-10-23). Drafts stop printing `(2023)` after the project title. |

### Outcomes: AI-written with a number check

- The AI writes each outcome in its own words (no longer copied word for word), at most 3 per project, and **always writes numbers as digits**, copying every number exactly as the lines have it (no rounding, no maths of its own like "4× faster" from "4 s to 1 s").
- Code keeps an outcome only if **100 % of its numbers** appear in that project's lines (the range the AI returns in `lines`). Both sides are normalised first: `2,000` = `2k` = `2000`; `3x` = `3×`; `%`, `$` and spaces ignored. No tolerance (30 % ≠ 32 %) and no partial match: one wrong number drops the whole outcome.
- Outcomes with no numbers pass the check; that is why the user sees and can edit them in onboarding.
- Every drop is logged with its reason (like `merge.ts`'s "not word for word"), and the resume eval reports the **drop rate**. The rate is a measurement for tuning the prompt, not a threshold.
- Client names: code still swaps the names the AI lists in `clientNames`.

## Experience (agreed)

| Field | Decision |
|---|---|
| `title` | Keep (AI copies it; code checks it is in the job's lines). |
| `highlights` | Keep, **AI-written** with the same 100 % number check as outcomes; shown in onboarding as pre-filled, editable text. They replace the summary. |
| `skills` | Keep (AI picks from our taxonomy's shortlist; code checks each label is in the lines). |
| `categories` | Keep (AI picks from our 12 job types). |
| `summary` | **Drop** (drafts don't use it for roles; highlights describe the job). |
| Dates (`start`, `end`, `current`) | **Drop.** Drafts stop printing `(2022-now)`. |
| `organisation`, `organisationDescription`, `employmentType` | **Drop all three.** No employer name is stored or shown, and drafts never name an employer (`mentionEmployers` and the "at …" part of the draft's role line go too). |
| `domains` | **Drop.** |

### Keeping names out of highlights

1. The prompt: "never name a company or client; describe them instead".
2. The AI lists any name it saw in each source line (`clientNames`) and code swaps it for the generic phrase.
3. The user sees and can edit every highlight in onboarding (catches a name the AI missed).

Proposed (confirm when building): keep the names the AI listed as a hidden per-job list, and have the draft checker reject a draft containing one (it replaces the `organisation` block list in `packages/core/src/drafts/validate.ts`). The user never sees or types it.

## Number check: reuse the drafts one

`packages/core/src/drafts/validate.ts` already pulls numbers out of text (`numberTokens`) to reject drafts with numbers the evidence doesn't support. Reuse it (move it somewhere shared in core if needed) for the outcome/highlight check instead of writing a new one.

## Touches (when built)

- Prompt + schema: `apps/worker/src/resume/steps/work.ts`, `work-lists.ts`, `step-types.ts` → `work@3`; rewrite the prompt for the new fields.
- Checks: `apps/worker/src/resume/merge.ts` (number check replaces the word-for-word check for outcomes/highlights), `entries.ts`, `prepass.ts` and `dates.ts` (links, year and role dates removed).
- Core: `packages/core/src/work.ts` (entry and suggestion schemas), `drafts/evidence.ts`, `drafts/validate.ts` and the drafts prompt (no domains, project link, year, role dates or organisation; `mentionEmployers` removed).
- Database: a migration dropping the removed columns (`npm run db:generate`).
- Web: the onboarding Work step and profile edit (`work-step.tsx`, `entry-fields.tsx`, `work-cards.ts`, `server/onboarding/service.ts`, `server/profile/service.ts`).
- Eval: report the outcome/highlight drop rate.
- Update `docs/onboarding/conclusion.md` when built.
