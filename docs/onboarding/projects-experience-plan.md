# Projects and experience: build plan

Date: 2026-10-17 · Spec: `projects-experience-design.md` (read it first; this plan doesn't repeat its reasons). Branch: build on top of `feat/ingestion` (or a new branch cut from it).

## How to work

- **Test-first:** in every slice, write the listed tests, run them, see them fail for the right reason, then implement until they pass.
- **One slice = one reviewable change.** Each slice ends green: its tests, `npm run typecheck` and `npm run lint` all pass. Commit only when the user asks.
- **Docker:** the db and web tests need Postgres and Valkey. Run `npm run db:up` once per session. If `docker` isn't found, add `~/.docker/bin` to `PATH`.
- **No compatibility work.** Suggestions go straight to v2. After Slice 2's migration, run `npm run db:reset` locally (it deletes the dev database) and sign in again.
- **No evaluator.** Tests use the stub LLM (`apps/worker/test/stub-llm.ts`). Model quality is checked by hand on real resumes in Slice 8.
- Long sessions: run `caffeinate -i` so the laptop doesn't doze mid-test.

Workspaces: `@redlance/core`, `@redlance/db`, `@redlance/worker`, `@redlance/web`. Tests sit next to the code (`foo.ts` → `foo.test.ts`).

| Slice | What | Depends on |
|---|---|---|
| 0 | **Done.** Restore the worker tests deleted in `5645aeb` | — |
| 1 | Core: `work.ts`, step schemas, suggestions v2 | — |
| 2 | Database migration + Finish + step registration | 1 |
| 3 | The work step, manual entry only | 2 |
| 4 | Pre-pass: sections, entry blocks, dates, links | 1 |
| 5 | Two model steps, client-name removal, merge, pipeline | 4 |
| 6 | Pre-fill and re-import wiring | 3, 5 |
| 7 | Dev console report | 5 |
| 8 | Manual check on real resumes | all |

Slices 4–5 (worker) can run in parallel with 2–3 (db and web) once Slice 1 is in.

---

## Slice 0 (done): restore the deleted worker tests

**Done on 2026-10-17.** Commit `5645aeb` deleted these tests because commit `a61bd1b` had moved the fake LLM to `test/stub-llm.ts` without updating them. What was restored:
- `apps/worker/src/resume/{extract,clean,dates,sections,prepass,evidence,merge,pipeline}.test.ts`, plus `jobs/resume.test.ts` and `jobs/github.test.ts`. `resume.test.ts` and `pipeline.test.ts` now import `stubResumeResponder` from `../../test/stub-llm`.
- `env.test.ts`, rewritten for the current settings: no `LLM_MODE`, and the ingestion settings added.
- `runner.test.ts`, which no longer passes `LLM_MODE`.
- `db.test.ts`, which holds both the NOTIFY listener test and the lock tests.
- `apps/worker/scripts/vertex-check.ts`, so `npm run vertex:check -w @redlance/worker` works again.

**Baseline for this plan:** 601 tests pass (web 226, worker 216, core 82, db 51, llm 26). Typecheck and lint are clean. Every later slice must keep these passing and only add to the count.

**What this means for later slices:** extend the restored files rather than creating new ones where they fit:
- `sections.test.ts`, `dates.test.ts`, `prepass.test.ts` and `evidence.test.ts` in Slice 4;
- `merge.test.ts`, `pipeline.test.ts` and `jobs/resume.test.ts` in Slice 5.

New files are only for new modules: `entries.test.ts` and `names.test.ts`.

---

## Slice 1: core (`@redlance/core`)

Pure code: constants, schemas and the link check. This slice doesn't add `work` to `STEP_IDS` yet (Slice 2 does), so the database mirror test and the web flow stay green.

**Files:**
- create `packages/core/src/work.ts`, `work.test.ts`;
- change `packages/core/src/onboarding.ts` (`LIMITS`), `suggestions.ts`, `suggestions.test.ts`, `index.ts`;
- change the v2 writers so the worker still type-checks: `apps/worker/src/resume/merge.ts` and `apps/worker/src/github/map.ts` (`v: 2`, empty `projects`/`experience`);
- change test fixtures that build `v: 1` suggestions: `apps/web/src/server/onboarding/page-data.test.ts`, `imports.test.ts`, `apps/web/src/components/onboarding/import-status.test.ts`, `import-dev-log.test.ts`, `apps/worker/src/dev-report.test.ts`.

**Tests first:**

`work.test.ts`:
- `checkLink accepts https and http links` → `https://site.io/a` and `http://x.dev` pass, normalised.
- `checkLink adds https to a bare host` → `www.site.io` → `https://www.site.io/`.
- `checkLink trims trailing punctuation` → `https://site.io/a).` → `https://site.io/a`.
- `checkLink refuses credentials, ports, IPs and other schemes` → `https://u:p@x.io`, `https://x.io:8080`, `http://127.0.0.1`, `http://[::1]`, `javascript:alert(1)`, `data:…`, `ftp://x.io` all fail.
- `checkLink refuses hosts without a dot and links over 300 characters`.
- `DOMAIN_IDS are unique, lowercase and 30 long`; `every domain alias is unique`.
- `projectEntry draft allows empty fields`; `projectEntry complete needs title and summary`.
- `roleEntry complete needs title and organisationDescription`.
- `roleEntry refuses an end before the start`; `allows a current role with no end`.
- `freelance and contract roles lose their organisation` → the parsed `organisation` is `null`.
- `entries refuse more than the limits` (11 skills, 5 highlights, 4 links, 5 domains, 3 categories).
- `workSchemas.complete accepts empty lists` → `{ projects: [], experience: [] }` is valid; `mentionEmployers` defaults to `false`.
- `namesRemoved, hidden and source have defaults` (`false`, `false`, `"manual"`).

`suggestions.test.ts` (update and add):
- `parses v2 with projects and experience`.
- `refuses v: 1` and `refuses unknown keys` (strict).
- `projects and experience default to empty lists`.
- `meta.skipped defaults to an empty list`.
- `mergeSuggestions takes projects and experience from the resume only` → a GitHub part with entries (built by hand) doesn't add any.
- `suggestedStepData("work") maps entries with source "resume"` and keeps `namesRemoved`.

**Steps:**
1. `work.ts`:
   - constants `PROJECT_ROLES`, `PROJECT_KINDS`, `EMPLOYMENT_TYPES`, `ENTRY_SOURCES`, plus `DOMAINS` (id + aliases) and `DOMAIN_IDS`, from the spec's list;
   - `checkLink(input): { ok: true; url: string } | { ok: false; message: string }`;
   - `projectEntry(complete)` and `roleEntry(complete)`;
   - `workSchemas = { draft, complete }`;
   - `projectSuggestion` and `experienceSuggestion` (the entry fields without `source` and `hidden`).
2. `LIMITS` gains the spec's keys.
3. `suggestions.ts`:
   - `v: z.literal(2)`, `projects`, `experience`, `meta.skipped`;
   - `MergedSuggestions` gains `projects` and `experience` (resume part only);
   - add the `suggestedStepData("work", m)` overload (returns `workSchemas.draft` output).
4. Writers and fixtures: `v: 1` → `v: 2`.

**Verify:** `npm test -w @redlance/core`, `npm test -w @redlance/worker`, `npm test -w @redlance/web`, `npm run typecheck`, `npm run lint`.

**Done when:** core exports the work schemas, `checkLink` and suggestions v2; every workspace is green.

---

## Slice 2: database, step registration and Finish

**Files:**
- change `packages/db/src/schema.ts` and `packages/db/src/onboarding.test.ts`;
- generated: `packages/db/migrations/0008_projects_experience.sql` + `meta/`;
- change `packages/core/src/onboarding.ts` (`STEP_IDS`, `PAGE_TITLES`, `STEP_SCHEMAS.work`) and `onboarding.test.ts`;
- change `apps/web/src/server/onboarding/service.ts`, `service.test.ts`, `page-data.ts` (`reviewData` type only), `page-data.test.ts`;
- change `apps/web/src/app/api/v1/onboarding/onboarding.test.ts` (fixtures that complete every step now include `work`).

**Tests first:**

`packages/core/src/onboarding.test.ts`:
- `STEP_IDS are import, basics, skills, work, rates`.
- `PAGE_IDS end with review and have 6 entries`.
- `nextPage("skills") is work` and `nextPage("work") is rates`.
- `resumeAt returns work when skills is the last completed step`.

`packages/db/src/onboarding.test.ts`:
- `step list mirrors core` (existing; now includes `work`).
- `new value lists mirror core` → `PROJECT_ROLES`, `PROJECT_KINDS`, `EMPLOYMENT_TYPES`, `ENTRY_SOURCES` equal core's.
- `onboarding_steps accepts the work step`.
- `profile_projects refuses a bad kind, a position of 8, 11 skill ids, a 161-character summary`.
- `profile_experience refuses an organisation on a freelance role` and `refuses a contract role with an organisation`.
- `profile_experience refuses month 13`.
- `deleting a user deletes their projects and experience` (cascade).
- `profiles.mention_employers defaults to false`.

`apps/web/src/server/onboarding/service.test.ts`:
- `saveStep saves work as draft and complete`.
- `saveStep refuses work before skills is completed` → `STEP_ORDER`.
- `saveStep refuses rates before work is completed` → `STEP_ORDER`.
- `finishOnboarding writes projects and experience in order` → rows have `position` 0..n, `source`, `hidden`.
- `finishOnboarding with empty work lists writes no rows and succeeds`.
- `finishOnboarding sets mention_employers from the step`.
- `finishOnboarding sends the user back when work is a draft` → `STEP_ORDER` with `resumeAt: "work"`.

**Steps:**
1. `schema.ts`:
   - add `"work"` to `ONBOARDING_STEP_IDS` and add the four mirrored lists;
   - add `profileProjects` and `profileExperience` with every CHECK from the spec, plus `profiles.mentionEmployers`;
   - export the new tables from `index.ts`.
2. Run `npm run db:generate`. Read the SQL: it must drop and re-add `onboarding_steps_step_check`, create both tables with their CHECKs and the `(user_id, position)` index, and add the column.
3. Run `npm run db:reset` (it wipes local data on purpose).
4. Core: insert `"work"` into `STEP_IDS` after `"skills"`, set `PAGE_TITLES.work`, and set `STEP_SCHEMAS.work = workSchemas`.
5. `service.ts`:
   - `completedSteps` reads `work`;
   - `finishOnboarding` inserts both tables (skip the insert when a list is empty) and sets `mentionEmployers`.
6. Update the fixtures that complete every step.

The browser flow now reaches `/onboarding/work`, which has no form until Slice 3. Land Slices 2 and 3 together before clicking through.

**Verify:** `npm run db:up`, `npm test -w @redlance/core`, `npm test -w @redlance/db`, `npm test -w @redlance/web`, `npm run typecheck`, `npm run lint`.

**Done when:** the migration applies on a fresh database, every CHECK is tested, and Finish writes both tables.

---

## Slice 3: the work step, manual entry only

The step works without any import: the user adds cards by hand.

**Files:**
- create `apps/web/src/components/onboarding/work-step.tsx`, `work-cards.ts`, `work-cards.test.ts`;
- change `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx` (render `WorkStep`);
- change `review-step.tsx` and `review-format.ts` + `review-format.test.ts` (Projects & experience section);
- change `apps/web/src/app/(app)/dashboard/page.tsx` (`of 5` → `of ${PAGE_IDS.length}`);
- change `apps/web/src/components/onboarding/progress.tsx` only if a test shows it needs to.

**Tests first:**

`work-cards.test.ts` (the pure helpers the component uses):
- `addProject appends an empty manual card` and `refuses past 8`.
- `addRole appends an empty manual role` and `refuses past 6`.
- `removeAt removes only that card`.
- `setEmploymentType to freelance clears organisation`.
- `editing a card clears namesRemoved` → the note disappears after a change.
- `toggleHidden flips hidden`.
- `formatDates` → `Jan 2021 – Present`, `2019 – 2022`, `2023` (start only), `""` (none).
- `linkError` → returns `checkLink`'s message for a bad link, `null` for a good one.

`review-format.test.ts`:
- `summarises work` → "2 projects · 3 roles · employer names off"; "None added" for empty lists.

`apps/web/src/app/api/v1/onboarding/onboarding.test.ts`:
- `PUT /steps/work saves and returns next = rates`.
- `PUT /steps/work refuses a javascript: link` → 400 with a field error.
- `PUT /steps/work refuses 9 projects` → 400.

A dashboard test (if one exists for the card copy) checks `step N of 6`; otherwise check it by hand in Slice 8.

**Steps:**
1. `work-cards.ts`: the helpers above, typed by `StepDraft<"work">`. Each card gets a local key (`crypto.randomUUID()`) held next to the data, never saved.
2. `work-step.tsx`, built on `useStepForm` like `skills-step.tsx`:
   - two sections of cards; a collapsed view and an inline edit view;
   - Remove, "Use in replies", "Add a project" / "Add a role";
   - the employer switch with its hint; the "Replies are public" note;
   - the empty state; the "Client name removed" note when `namesRemoved`;
   - links rendered as text, no previews;
   - reuse the existing skill search for the skill chips and a simple chip picker for domains.
3. `[step]/page.tsx`: `{step === "work" && <WorkStep key={formKey} init={stepInit(state, user.userId, "work")} />}`.
4. Review: a section with titles, counts, the switch and an Edit link to `/onboarding/work`.
5. Dashboard copy.

**Verify:** `npm test -w @redlance/web`, `npm run typecheck`, `npm run lint`. By hand: `npm run dev`, then sign in → Import (skip) → Basics → Skills → **Projects & experience** (add one project and one role, Save draft, reload, the restore banner works, Next) → Rates → Review → Finish. Then `psql` shows the rows in `profile_projects` and `profile_experience`.

**Done when:** a user can finish onboarding with or without entries, and the progress bar and dashboard say "of 6".

---

## Slice 4: pre-pass (sections, entry blocks, dates, links)

Pure worker code. No model calls yet.

**Files:**
- change `apps/worker/src/resume/sections.ts`, `dates.ts`, `prepass.ts` (`projectLinks`), `pipeline.ts` (`buildPipelineInput` only), `steps/shared.ts` (`PipelineInput`);
- create `apps/worker/src/resume/entries.ts`;
- tests: extend the restored `sections.test.ts`, `dates.test.ts` and `prepass.test.ts` (links); create `entries.test.ts` (a new module).

**Tests first:**

`sections.test.ts`:
- `matches the new project headings` → "Personal Projects", "SIDE PROJECTS:", "Open Source Contributions", "Case studies", "Hackathons".
- `matches the new experience headings` → "Relevant Experience", "Career History", "Internships", "Freelance experience".
- `"Freelance projects" is projects, "Freelance experience" is experience`.
- `headed is false when no heading is found` and every section equals the whole text.

`dates.test.ts`:
- `findRanges returns each range with months` → "Jan 2021 – Present" → start 2021-01, current; "2019-2022" → months null.
- `findRanges skips education lines`.
- `yearsOfExperience is unchanged` → cases that cover the old behaviour (overlaps merged, rounded down to 0.5, `null` with no dates).

`entries.test.ts`:
- `splits at a head line after bullets`.
- `keeps a two-line header in one block` (title line + company/date line).
- `starts a new experience block at a second dated head line`.
- `falls back to date lines when there are no blank lines or bullets`.
- `falls back to one block when nothing splits`.
- `caps at 12 blocks, the rest joins the last` and `caps a block at 3,000 characters`.
- `numbers blocks E1.. and P1..`.
- `attaches the first date range and the project year` → the year comes from the range, otherwise from a plain year, otherwise `null`.

`prepass.test.ts` (extend; links):
- `finds scheme, www and lowercase domain/path links` in a block.
- `ignores Node.js/React, ASP.NET/C# and email addresses`.
- `keeps at most 3 per block and only those passing checkLink`.

`pipeline.test.ts` (extend; `buildPipelineInput` only):
- `buildPipelineInput fills headed, projectBlocks and experienceBlocks`.
- `projectBlocks is empty when headed is false`.

**Steps:**
1. `sections.ts`: the new regexes; export `splitSectionsWithFlag(text)` (or make `splitSections` return `{ sections, headed }` and update its two callers).
2. `dates.ts`: extract `findRanges`; rebuild `yearsOfExperience` on it.
3. `entries.ts`: `splitEntries(section, kind)` as in the spec.
4. `prepass.ts`: `projectLinks(blockText)` with the regex, the TLD list moved from `merge.ts`, and core `checkLink`.
5. `PipelineInput` gains `headed`, `projectBlocks: Block[]` and `experienceBlocks: Block[]`; `buildPipelineInput` fills them.

**Verify:** `npm test -w @redlance/worker`, `npm run typecheck`, `npm run lint`.

**Done when:** the pre-pass gives numbered blocks with dates, years and links, and the existing steps see no change in their input.

---

## Slice 5: two model steps, client-name removal, merge, pipeline

**Files:**
- create `apps/worker/src/resume/names.ts`, `names.test.ts`, `steps/projects.ts`, `steps/experience.ts`;
- change `step-types.ts` (per-call schema builders), `steps/shared.ts` (`StepSpec.timeoutMs`, `skip`), `merge.ts`, `pipeline.ts`;
- change `packages/core/src/suggestions.ts` (`RESUME_STEP_NAMES` gains `projects` and `experience`);
- change `apps/worker/test/stub-llm.ts` and `stub-llm.test.ts`;
- tests: extend the restored `merge.test.ts`, `pipeline.test.ts` and `jobs/resume.test.ts`; create `names.test.ts` (a new module).

**Tests first:**

`names.test.ts` (`replaceNames`):
- `replaces a name that is present` → "Built a site for Acme Corp" + Acme Corp→"a retail client" → "Built a site for a retail client"; `replaced` = ["Acme Corp"].
- `ignores a name that is absent` → the text is unchanged; `replaced` is empty.
- `replaces several names` → two clients in one line, both replaced.
- `matches regardless of case` → "ACME corp" in the text, "Acme Corp" from the model → replaced.
- `does not match inside a longer word` → "Acme" doesn't touch "Acmeville" or "Acme2".
- `replaces the longest name first` → "Acme" and "Acme Corp" → "Acme Corp" is replaced whole.
- `escapes regex characters` → "C&A", "Yahoo!" and "Node (UK)" match literally.
- `ignores 1-character names and a generic that contains the name`.
- `uses "a client" for an empty generic`.
- `replaces every occurrence in the line`.

`merge.test.ts` (projects and experience):
- `drops an entry whose title isn't in its block`.
- `drops an outcome or highlight that isn't verbatim`.
- `runs the verbatim check before replacing names` → a line is kept when it's verbatim in the original, even though the stored copy differs.
- `replaces client names in highlights and sets namesRemoved`.
- `applies an entry's names to its summary and title`.
- `scrubs a freelance role's organisation from its highlights and summary, then drops it` (backup with no `clientNames` from the model).
- `does the same for a contract role`.
- `replaces the employer name in a full-time role's highlights but keeps organisation`.
- `sets organisation to null when it isn't in the block`.
- `fixes an organisationDescription that contains the organisation`.
- `drops skills whose label isn't in the block`.
- `strips links from summaries and drops summaries with an email or phone number`.
- `attaches dates, year and links from the block`, not from the model.
- `keeps resume order, removes duplicate titles, caps at 8 projects and 6 roles`.
- `records drops and replaced names` in `DroppedItem` / `ReplacedName`.

`pipeline.test.ts` (stub LLM):
- `runs five steps and returns v2 with projects and experience`.
- `skips projects when headed is false` → `meta.skipped` has `projects`; no request is sent.
- `skips experience when the experience section is empty`.
- `marks a failed new step partial and keeps the others`.
- `uses the fast model and a 14 s timeout for the new steps`.
- `the deadline is 25 s` (inject a small `deadlineMs` and check it aborts).
- `resumeCacheKey includes projects@1 and experience@1` and starts with `resume@2`.
- `the per-call schema refuses an unknown block id or a skill outside the shortlist`.

`jobs/resume.test.ts` (extend):
- `a resume job stores v2 suggestions with projects and experience` (stub LLM). This is the end-to-end check through the job, the cache and the stored result.
- `a cached resume@1 result is not reused` → the new cache key misses it.

`stub-llm.test.ts`:
- `answers the projects and experience tasks` with blocks, verbatim lines and one client name per first highlight.

**Steps:**
1. `names.ts`: `replaceNames` (NFKC + case-insensitive, `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, longest first, escaped).
2. `step-types.ts`: `projectsSchemaFor(blockIds, shortlist)` and `experienceSchemaFor(...)`, following `outputSchemaFor`; `clientNames` on each outcome and highlight.
3. `StepSpec`:
   - add `timeoutMs?` and `skip?(input)`;
   - make `schema` either fixed or `schemaFor(input)`;
   - `pipeline.ts` uses them.
4. `steps/projects.ts` and `steps/experience.ts`: `model: "fast"`, `maxOutputTokens: 2000`, `timeoutMs: 14_000`, versions `projects@1` / `experience@1`. Prompts:
   - numbered blocks inside `<resume>` (through `resumePrompt`);
   - the shortlist, categories and domain list;
   - the rules from the spec: no names in titles or summaries, list client names with a generic phrase, copy lines word for word, in-job work → highlights, `unknown` rather than guess.
5. `merge.ts`: `mergeWork(steps, ctx)` implementing the spec's checks table and the name-removal order; `mergeResumeSteps` calls it and writes `projects`, `experience` and `meta.skipped`.
6. `pipeline.ts`:
   - `STEPS` gains the two steps;
   - `PIPELINE_VERSION = "resume@2"`, `PIPELINE_DEADLINE_MS = 25_000`;
   - skipped steps go into `meta.skipped`, not `partial`;
   - "every step failed" counts only the steps that ran.
7. Core: `RESUME_STEP_NAMES` gains the two names.
8. Stub: recognise `Task: projects` and `Task: experience`, and answer from the blocks deterministically.

**Verify:** `npm test -w @redlance/core`, `npm test -w @redlance/worker`, `npm run typecheck`, `npm run lint`.

**Done when:** a stubbed resume import returns v2 suggestions with checked projects and experience, client names are replaced, and the cache key changes.

---

## Slice 6: pre-fill and re-import wiring

**Files:**
- change `apps/web/src/server/onboarding/page-data.ts` + `page-data.test.ts`;
- change `apps/web/src/server/onboarding/imports.ts` + `imports.test.ts`;
- change `apps/web/src/app/api/v1/onboarding/imports.test.ts`;
- change `apps/web/src/components/onboarding/import-step.tsx` (dialog copy) and `[step]/page.tsx` (`hasSavedProfileSteps` includes `work`);
- change `work-step.tsx` (partial notice).

**Tests first:**

`page-data.test.ts`:
- `work shows the saved row when there is one`.
- `work shows resume suggestions when there is no row` → entries with `source: "resume"` and `namesRemoved` kept.
- `work is empty with no import, or with only a GitHub import`.
- `work falls back to empty when the suggestions don't parse`.

`imports.test.ts` (server and API):
- `reset deletes basics, skills and work, and keeps import and rates`.
- `GET /imports/:id returns projects and experience`.

`work-cards.test.ts` (add):
- `partialNotice` → the message for `projects`, for `experience`, for both, and `null` for none.

**Steps:**
1. `defaultsFor`: handle `"work"` next to Basics and Skills with `suggestedStepData("work", merged)`.
2. `resetForReimport`: `inArray(onboardingSteps.step, ["basics", "skills", "work"])`.
3. The dialog: "Replace Basics, Skills, and Projects & experience?" with matching body text; `hasSavedProfileSteps` checks all three steps.
4. `work-step.tsx`: show the partial notice from the latest resume import's `partial`. Pass it in from the page, the way `imports` reaches `ImportStep`.

**Verify:** `npm run db:up`, `npm test -w @redlance/web`, `npm run typecheck`, `npm run lint`.

**Done when:** a finished resume import pre-fills the work step, and a re-import clears it after the user confirms.

---

## Slice 7: dev console report

**Files:** change `apps/worker/src/dev-report.ts` and `dev-report.test.ts`; check the call sites in `apps/worker/src/jobs/resume.ts`.

**Tests first** (`dev-report.test.ts`):
- `prepass prints headed and each block` → id, length, date range, year, links.
- `prints skipped steps` → "projects: skipped (no Projects heading)".
- `merge prints dropped projects, roles and lines`.
- `merge prints replaced names` → `"Acme Realty" → "a US real-estate agency"`.
- `prints nothing when disabled` (existing, still passes).

**Steps:**
1. `prepass()`: add the block lines.
2. `merge()`: take `replaced: ReplacedName[]` from `MergeReport` and print them.
3. `pipeline.ts`: `MergeReport` gains `replaced` and `skipped`.

**Verify:** `npm test -w @redlance/worker`, `npm run typecheck`, `npm run lint`.

**Done when:** a local import prints blocks, the two new steps, drops and replaced names.

---

## Slice 8: manual check on real resumes

There's no evaluator; this is the quality check. It needs Vertex credentials (see CLAUDE.md, "To run resume import against Vertex locally").

**Steps:**
1. `npm run db:reset`, then `npm run dev`. Sign in at `/login`.
2. Import 4–6 real resumes (the user's own, plus volunteers' with consent; never commit them). Cover these cases:
   - a developer resume with a Projects section and links;
   - a freelancer who names clients;
   - a resume with no headings;
   - a student with academic or hackathon projects;
   - a non-developer (design, video or writing).
3. For each, read the worker console report, then the work step. Check:
   - every project comes from the Projects section, and no job became a project;
   - roles have the right titles, dates and "current"; freelance and contract roles have no organisation;
   - **no client name is left** in any title, summary, highlight or outcome, and "Client name removed" shows where expected;
   - links match the resume, and no request to them appears in the worker or browser network log;
   - skills and domains make sense;
   - the import finishes within 25 s; note the latency and cost of each step from the report.
4. Edit a card, remove one, add one by hand, toggle the employer switch, then Finish. Check the rows in `profile_projects`, `profile_experience` and `profiles.mention_employers`.
5. Re-import a resume: the dialog names all three steps, and the work step refills.
6. Run the full suite: `npm test`, `npm run typecheck`, `npm run lint`.

**Write down** what went wrong (missed names, bad splits, wrong kinds) and fix the prompts, regexes or heuristics with a new unit test for each fix. Bump the step's prompt version when its prompt changes.

**Done when:** every resume in the set passes the checklist, and the full suite is green. Then update `conclusion.md` and CLAUDE.md's "Where we are" (user's call on committing).
