# Phase 3: Evidence builder and context loader

Model: **Sonnet** · Runs after Phase 2

## Why

The AI should see only the few facts that matter for this post, chosen by code for free: the right project, the right role, three skills, one link, and the rate and availability notes. This keeps the prompt small (~3,500 tokens) and is where the privacy rules are enforced. Hidden entries and employer names must never reach the model.

**Important finding:** `matches.best_project_id` and `best_role_id` are only set by the AI re-scorer (`completeRescore` in `packages/db/src/matches.ts`), which is **off**. The rule matcher writes null. So this phase ranks projects and roles itself, and uses the match's values only when they're present.

## Files

### `packages/core/src/drafts/evidence.ts` (new, pure)

`buildEvidence(input) → Evidence`. `input` = `{ post, analysis, match, profile, projects, roles, exclude?: { projectIds: string[] } }`, all plain objects (no db).

1. **`rankProjects(projects, post)`:**
   - drop hidden ones;
   - score by overlap of `skillIds` with the post's skills (core skills ×3, others ×1), then shared `categories` (×2), then `domains` (×1);
   - ties → the most recent `year`, then `position`.

   **`rankRoles`** is the same, over `profile_experience`, with `isCurrent` or the latest end date breaking ties.
2. **Pick:**
   - `match.bestProjectId`, if set and visible, else the top-ranked project not in `exclude.projectIds`;
   - the same for the role;
   - either can be null.
3. **Skills:** the matched skill ids from `match.features` (`core_skill`, `secondary_skill`, `work_overlap` details), deduplicated, in the post's `skill_ids` order, top 3, mapped to names.
4. **Link:** the chosen project's first link, else `https://github.com/<githubUsername>`, else null. This becomes `allowedLinks` (0 or 1 entries).
5. **Rate note:** use `budgetFit()` from `packages/core/src/matching/score.ts`. `fits` → `{ mention: true, text }`; otherwise `{ mention: false }`.
6. **Availability:** a deadline within 7 days of `now` → `"can start this week"`; otherwise null.
7. **Red flags (for the user, never put in the prompt):** `analysis.redFlags`, plus `"unpaid"` or `"portfolio_only"` from `payType`.
8. **Privacy:**
   - role `organisation` is included only when `profile.mentionEmployers` is true; otherwise only `organisationDescription`;
   - run `scrubOrganisations(text, orgNames)` from `packages/core/src/client-names.ts` over project and role summaries, highlights and outcomes whenever employers are off.
9. **`evidenceText`:** one string of every fact sent to the AI (project summary, outcomes, role highlights, dates, skills, budget, deadline). Phase 4's number check reads it.
10. **`summary`:** `{ projectTitle, roleTitle, skills }`, for the UI line "Using: …".

`Evidence` (fill in the type from Phase 1):
- `project`, `role`, `skills`, `allowedLinks`, `rateNote`, `availability`, `redFlags`, `broad`;
- `employerNamesAllowed`, `organisationNames` (for the validator);
- `evidenceText`, `summary`, `citedProjectIds`.

### `packages/db/src/drafts.ts` (new)

`loadDraftContext(db, { userId, matchId }) → DraftContext | null`:
- one or two queries, with independent ones run in parallel;
- returns the match (features, broad, rule_reason, best ids, withdrawn_at), post (title, body, subreddit, url), analysis (including `apply_instructions`), profile, visible projects, visible roles, `alsoPostedIn`;
- returns null when the match isn't this user's or is withdrawn.

Export from `packages/db/src/index.ts`.

## Test cases

`packages/core/src/drafts/evidence.test.ts`, with fixtures modelled on `matching/score.test.ts` (e.g. `priya`):

| # | Case | Expect |
|---|---|---|
| 1 | 3 projects; one shares 2 core skills with the post | that one is chosen |
| 2 | Two tied projects, years 2023 and 2025 | 2025 |
| 3 | The best project is hidden | never chosen; it doesn't appear in `evidenceText` |
| 4 | `match.bestProjectId` set and visible | used, even if the ranking differs |
| 5 | `match.bestProjectId` points to a hidden project | ignored; the ranking is used |
| 6 | `exclude.projectIds` contains the top project | the second one is chosen ("different project") |
| 7 | No projects at all | project null; the role is still chosen |
| 8 | Matched skills in features, out of the post's order, 5 of them | the top 3 in the post's order |
| 9 | Project with links | `allowedLinks` = [its first link] |
| 10 | No project link, GitHub username set | [the GitHub URL] |
| 11 | Neither | [] |
| 12 | Budget fits the min rate | `rateNote.mention` true |
| 13 | Budget below the min rate, or no budget | `mention` false |
| 14 | Deadline in 3 days; in 20 days | "can start this week"; null |
| 15 | Red flags + `payType` unpaid | in `redFlags`; **not** in `evidenceText` |
| 16 | `mentionEmployers` false, role at "Acme Realty", summary mentions "Acme Realty" | no "Acme Realty" anywhere in the evidence; `organisationNames` contains it |
| 17 | `mentionEmployers` true | the organisation is included |
| 18 | Freelance role (organisation null) | no organisation; no crash |
| 19 | A broad match | `broad` true; skills [] |

`packages/db/src/drafts.test.ts` (test database):

| # | Case | Expect |
|---|---|---|
| 20 | A seeded match for the user | context with post, analysis, profile, projects, roles |
| 21 | Another user's match id | null |
| 22 | A withdrawn match | null |
| 23 | Hidden projects and roles | not returned |

## Done when

- All 23 cases pass and the whole repo is green.
- "## Phase 3: done" in `plan/build-notes.md`: the ranking weights used, and a sample `evidenceText` for one fixture.
