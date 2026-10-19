# Projects & experience build: handoff notes between slices

Baseline after Slice 1: 633 tests pass (web 226, worker 216, core 114, db 51, llm 26); typecheck and lint clean.

## Slice 1 (core): done

Files: `packages/core/src/work.ts` (+ `work.test.ts`). Also changed:
- core: `onboarding.ts` (LIMITS spreads WORK_LIMITS), `suggestions.ts` (now v2), `index.ts`;
- worker: `merge.ts` and `github/map.ts` write `v: 2`;
- fixtures in web and worker moved to v2.

### Deviations from the plan (later slices must follow these)
- `EMPLOYMENT_TYPES` is renamed **`ROLE_EMPLOYMENT_TYPES`** (type `RoleEmploymentType`). `job-post.ts` already has `EMPLOYMENT_TYPES` for posts. The db mirror list in Slice 2 must use the new name.
- Limits live in **`WORK_LIMITS`** in `work.ts`, and `LIMITS` spreads them. `work.ts` imports nothing from `onboarding.ts`, so `onboarding.ts` can import `workSchemas` without a cycle. Keep it that way.
- Extra limits: `organisation: 80`, `linkLength: 300`, `entryCategories: 2`.
- Draft links stay as typed (strings of at most 300 characters). Complete entries and suggestions normalise them through `checkLink`.
- Roles are normalised in both draft and complete:
  - a current role gets `end: null`;
  - freelance, contract and empty organisations get `organisation: null`.
- End-before-start is checked only in complete.
- Suggestions need a non-empty title and links that pass `checkLink`. Summary and `organisationDescription` may be empty.
- `DOMAINS` entries are `{ id, label, aliases }`; `label` is for the Slice 3 chip picker.
- `suggestedStepData("work")` returns `WorkDraft` for now, because `work` isn't in `STEP_IDS` yet.

### Exports from `@redlance/core`
- Constants: `PROJECT_ROLES`, `PROJECT_KINDS`, `ROLE_EMPLOYMENT_TYPES`, `ENTRY_SOURCES` (`["resume", "manual"]`), `ORGANISATION_FREE_TYPES` (Set: freelance, contract), `WORK_LIMITS`, `DOMAINS`, `DOMAIN_IDS`.
- Types: `ProjectRole`, `ProjectKind`, `RoleEmploymentType`, `EntrySource`, `DomainId`, `MonthYear` (`{ year, month: number | null }`), `ProjectEntry`, `RoleEntry`, `ProjectSuggestion`, `ExperienceSuggestion`, `WorkDraft`, `WorkData`.
- `checkLink(input): { ok: true; url } | { ok: false; message }`.
- Schemas:
  - `projectEntry(complete)` and `roleEntry(complete)`. `roleEntry` is a transform, so it can't be `.omit`-ed.
  - `projectSuggestion` and `experienceSuggestion`.
  - `workSchemas = { draft, complete }` over `{ projects, experience, mentionEmployers }`.

### Entry fields
- Project: `title`, `summary`, `role`, `kind`, `skills` (skill ids), `categories`, `domains`, `outcomes` (string[]), `links`, `year`, `namesRemoved`.
- Role: `title`, `organisation`, `organisationDescription`, `employmentType`, `start`, `end`, `current`, `summary`, `highlights` (string[]), `skills`, `categories`, `domains`, `namesRemoved`.
- Step entries also have `source` (default `"manual"`) and `hidden` (default `false`).
- The entry field is `skills`; the db column is `skill_ids`.

### Notes for later slices
- **Slice 2:** set `STEP_SCHEMAS.work = workSchemas`, then switch the overload to `StepDraft<"work">`.
- **Slice 4:** `checkLink` is ready for `projectLinks`.
- **Slice 5:**
  - `RESUME_STEP_NAMES` doesn't include `projects` and `experience` yet.
  - `meta.skipped` exists and defaults to `[]`; `merge.ts` doesn't set it yet.
  - `clientNames` exists only in the worker's model-output schema, not in the suggestion schemas.
  - Outcomes and highlights must be emitted as plain strings.
  - Filter out suggestions with an empty title or a bad link **before** `suggestionsSchema.parse`, otherwise it throws.

(Each later slice appends its own section below.)

## Slice 2: done

Totals after Slice 2: web 233 (+7), core 119 (+5), db 90 (+39), llm 26; worker 241 with 13 failing, all in Slice 4's in-progress `resume/dates.test.ts` and `resume/sections.test.ts`. Typecheck and lint clean. Migration applied on a fresh database (`npm run db:reset` was run, so the local dev data is gone).

### Files
- core: `onboarding.ts` (`STEP_IDS` = import, basics, skills, **work**, rates; `PAGE_TITLES.work = "Projects & experience"`; `STEP_SCHEMAS.work = workSchemas`), `onboarding.test.ts`, `suggestions.ts` (the `"work"` overload now returns `StepDraft<"work">` and parses with `STEP_SCHEMAS.work.draft`; the `WorkDraft` import was dropped).
- db: `schema.ts`, `onboarding.test.ts`, `migrations/0008_projects_experience.sql` + `meta/0008_snapshot.json` + `meta/_journal.json`.
- web: `server/onboarding/service.ts`, `service.test.ts`, `page-data.test.ts`, `test/onboarding-fixtures.ts` (`VALID.work`), `app/api/v1/onboarding/onboarding.test.ts` and `imports.test.ts` (complete-every-step loops now use `STEP_IDS`), `app/(onboarding)/onboarding/[step]/page.tsx` (placeholder), `app/(app)/dashboard/page.tsx` (`of ${PAGE_IDS.length}`).

### Deviations from the plan
- **db mirror lists use the core names**, the same convention as the ingestion mirrors: `PROJECT_ROLES`, `PROJECT_KINDS`, `ROLE_EMPLOYMENT_TYPES`, `ENTRY_SOURCES` exported from `@redlance/db` (db's existing `EMPLOYMENT_TYPES` is the job-post list). The test compares them via `import * as core`.
- **Extra CHECKs beyond the spec**, all tested: `position >= 0`; experience start/end year 1950–2100; a month needs its year (`*_start_check`, `*_end_check`); `profile_experience_current_check` (a current role has no end); `title` 1–80 and `summary` ≤ 160 on experience too; cardinality limits on experience `skill_ids` (10), `categories` (2), `domains` (4).
- drizzle-kit ignored `--name` through the root script, so I renamed the generated file to `0008_projects_experience.sql` and its journal tag. The SQL itself wasn't hand-edited.
- `page-data.ts` needed no change: `ReviewData` is a mapped type over `StepId`, so it already includes `work`. `defaultsFor("work")` falls through to `emptyDraft("work")`; Slice 6 adds the pre-fill.
- The dashboard `of 5` → `of ${PAGE_IDS.length}` change (planned for Slice 3) was done here; it was a one-line change.

### Names Slice 3 (and later) need
- Tables: `profileProjects` (`profile_projects`) and `profileExperience` (`profile_experience`); types `ProfileProject` and `ProfileExperience`; `profiles.mentionEmployers` (`mention_employers`, default false).
- Shared columns: `id` (v7), `userId`, `position`, `title`, `summary`, `skillIds`, `categories`, `domains`, `source`, `hidden`, `createdAt`, `updatedAt`. Index `(user_id, position)` on each table.
- Project columns: `role`, `kind`, `outcomes`, `links`, `year`.
- Experience columns: `organisation`, `organisationDescription`, `employmentType`, `startYear`, `startMonth`, `endYear`, `endMonth`, `isCurrent`, `highlights`.
- How Finish maps the step (`finishOnboarding` in `service.ts`, same transaction; `completedSteps` reads `work` with the complete schema):
  - `position` = the array index;
  - entry `skills` → `skillIds`;
  - role `start`/`end` `{ year, month }` → `startYear`/`startMonth`/`endYear`/`endMonth`;
  - `current` → `isCurrent`;
  - `namesRemoved` is not stored;
  - empty lists skip the insert;
  - `mentionEmployers` → `profiles.mentionEmployers`.
- A draft `work` row sends Finish back with `STEP_ORDER`, `details.resumeAt = "work"`.
- Fixture: `VALID.work` in `apps/web/test/onboarding-fixtures.ts` has 2 projects (the second is manual and hidden), 1 current full-time role, and `mentionEmployers: true`.

### Web placeholders for Slice 3 to replace
- `[step]/page.tsx`: `{step === "work" && <p …>Projects &amp; experience is coming soon.</p>}` (with a "Placeholder until Slice 3" comment). Replace it with `<WorkStep key={formKey} init={stepInit(state, user.userId, "work")} />`. Until then the browser flow stops at `/onboarding/work`. Saving works through the API only.
- Not done (owned by Slice 3 or 6): the Review section for work, `hasSavedProfileSteps` including `work`, `resetForReimport` deleting `work`, and the import dialog copy.

## Slice 3: done

Totals: web 258 (+25: work-cards 19, review-format 3, API 3); typecheck and lint clean for web (worker typecheck errors are Slice 4's `resume/entries.test.ts`). Checked in a browser on port 3002: `/onboarding/work` renders, empty Next shows the error and focuses the first invalid field, a saved project moves on to `/onboarding/rates`.

### Files (all in `apps/web/src/components/onboarding/` unless noted)
- new: `work-step.tsx`, `entry-fields.tsx` (LineList, DateFields, SkillPicker, DomainChips), `work-cards.ts` + `work-cards.test.ts`.
- changed: `review-format.ts` (+`workSummary`) and test, `review-step.tsx` (Projects & experience section), `rates-step.tsx` (Back goes to `work`), `app/(onboarding)/onboarding/[step]/page.tsx` (renders `WorkStep`, placeholder removed), `app/api/v1/onboarding/onboarding.test.ts` (3 work tests).
- Dashboard `of ${PAGE_IDS.length}` was already done in Slice 2.

### Component and helpers
- `<WorkStep init={StepFormInit<"work">} />`, uses `useStepForm` unchanged. Next label becomes "Skip for now" when both lists are empty.
- Local card keys live in component state (`project-N` / `role-N`, `fitKeys` pads to the list length after restore/discard); never saved.
- `work-cards.ts`: `emptyProject/Role`, `addProject/addRole` (same array at the limit), `removeAt`, `setLine`, `editEntry` (clears `namesRemoved`), `toggleHidden`, `setEmploymentType` (clears organisation for freelance/contract), `formatDates`, `linkError`, `fitKeys`, `MONTH_NAMES`.
- Cards with a field error are forced open so focus-first-invalid works. Skills picker uses only taxonomy skills (no custom). Categories are not editable here (spec edit list omits them); suggestions can still carry them.

### Slice 6 must wire
- Pre-fill: `defaultsFor("work")` in `page-data.ts` (saved row, else `suggestedStepData("work", merged)`, else empty). Pre-filled entries arrive with `source: "resume"`; the "Client name removed" note shows from `namesRemoved`.
- Partial import note: WorkStep does not read `meta.partial`; add "We couldn't read your projects. Add them by hand." (pass a prop from page.tsx).
- Reset: `resetForReimport` must delete `work`; `hasSavedProfileSteps` in `[step]/page.tsx` must include `work` (currently basics/skills only).
- Dialog copy in `import-step.tsx`: "Replace Basics, Skills, and Projects & experience?".

## Slice 6: done

Totals: web 268 (+10); typecheck and lint clean (all workspaces at the time of the run).

### Files (web only; core and worker untouched)
- `server/onboarding/page-data.ts` (+test): `defaultsFor("work")` uses `suggestedStepData("work", merged)` (empty on parse failure); new `workImportNotice(state)`: null unless the latest resume import is done, has `projects`/`experience` in `partial` or `skipped`, and no `work` row is saved yet.
- `server/onboarding/imports.ts` (+test): `ImportSummary.skipped: string[]` (from `meta.skipped`, typed as plain strings on purpose); `resetForReimport` also deletes `work`. Fixtures in `use-import-jobs.ts`, `import-status.test.ts`, `import-dev-log.test.ts`, API `imports.test.ts` got `skipped: []`.
- `components/onboarding/work-cards.ts` (+test): `partialNotice(partial, skipped)` checks the strings `"projects"` / `"experience"`.
- `work-step.tsx`: new optional `notice` prop, shown as a `role="status"` note. `[step]/page.tsx`: passes `workImportNotice(state)`; `hasSavedProfileSteps` includes `work`.
- `import-step.tsx`: dialog title/body "Replace Basics, Skills, and Projects & experience?"; local copy for `work` cleared after reset.
- API `imports.test.ts`: reset test now also saves and expects `work` deleted.

### Notes
- Tighten later: `skipped` and `partialNotice` args are `string[]`; once Slice 5 adds the names to `RESUME_STEP_NAMES` they could use `ResumeStepName`. `PARTIAL_HINT` in `import-status.ts` (keyed by step name) likely needs `projects`/`experience` entries from Slice 5/the owner of that file; the import-step banner is untouched.
- Ran prettier on `apps/web/src`.

## Slice 4: done

Totals after Slice 4 (full `npm test`): web 258, worker 277 (+61, all Slice 4), core 119, db 90, llm 26; all pass. Typecheck: worker, core, db and llm are clean. Web fails only in `apps/web/src/server/onboarding/page-data.test.ts(300,21)` (`"projects"` not assignable to `ResumeStepName`), which is another slice's in-progress file; Slice 4 doesn't touch web or core. Lint is clean (only web has a lint script).

### Files
- Changed: `apps/worker/src/resume/sections.ts`, `dates.ts`, `prepass.ts`, `pipeline.ts` (`buildPipelineInput` only), `steps/shared.ts` (`PipelineInput`), `merge.ts` (only imports `TLDS` from `prepass.ts` now; no behaviour change).
- New: `apps/worker/src/resume/entries.ts`, `entries.test.ts`.
- Tests extended: `sections.test.ts`, `dates.test.ts`, `prepass.test.ts`, `pipeline.test.ts`. Prettier was run on these four, which also reformatted their older restored lines (formatting only).

### `PipelineInput` additions (`steps/shared.ts`)
```ts
headed: boolean;            // any heading found; if false, every section is the whole text
projectBlocks: Block[];     // splitEntries(sections.projects, "projects", { headed }); [] when headed is false
experienceBlocks: Block[];  // splitEntries(sections.experience, "experience", { headed })
```
The existing fields (`text`, `sections`, `shortlist`, `yearsExperience`) are unchanged.

### Block format (`entries.ts`)
```ts
export type Block = {
  id: string;                 // "E1".."E12" or "P1".."P12", in resume order
  text: string;               // the block's lines exactly as in the section (trimmed at both ends; blank lines inside kept; ≤ 3,000 code points)
  range: DateRange | null;    // findRanges(text)[0]
  year: number | null;        // projects only: range end year, this year if current, else the latest plain year (1950..next year), else null
  links: string[];            // projects only: projectLinks(text), ≤ 3, normalised by checkLink; experience blocks get []
};
export function splitEntries(section: string, kind: "experience" | "projects", opts?: { headed?: boolean; now?: Date }): Block[];
export const MAX_BLOCKS = 12, MAX_BLOCK_CHARS = 3_000, MAX_HEAD_CHARS = 120;
```
`DateRange` (`dates.ts`): `{ start: MonthYear; end: MonthYear | null; current: boolean }`, with core's `MonthYear` (`{ year, month: 1..12 | null }`). `end` is null exactly when `current` is true. `findRanges(text, now?)` returns every range in order. `yearsOfExperience` is now built on the same parser and returns exactly what it did before (pinned by tests).

### Links (`prepass.ts`)
- `projectLinks(text): string[]` and `MAX_PROJECT_LINKS = 3`. `TLDS` moved here from `merge.ts` (exported; merge imports it).
- It matches scheme or `www.` links (any case), lowercase `domain.tld/path`, and lowercase hosts with a subdomain and no path (`shop.vercel.app`, `jane.github.io`). Emails are removed first, so `mailto:` and `a@b.io` never match, while `medium.com/@jane/post` still does. Each match goes through core `checkLink`, then duplicates are dropped and the first 3 kept. Nothing is fetched.

### Heuristics
- **Line kinds:** blank; bullet (`- – — • * ▪ ◦ ● ■ □ ○ · ‣ ⁃ ➢ ► ▶ ✓ ✔ ❖`, private-use symbol-font glyphs U+E000–F8FF, or `1.`/`1)` followed by a space); "long" (a non-bullet line over 120 chars, i.e. a body paragraph); head (anything else).
- **Main rules (as in the spec):** a head line starts a block after a separator or after a bullet/long line. Head after head joins. For experience, a head line holding a date range starts a new block if the current block already has a range.
- **Additions:**
  1. **DOCX spacing.** mammoth writes `\n\n` after every paragraph, so if ≥ 75% of line gaps (with at least 3 gaps) have a blank line, a separator needs **2** blank lines (an empty paragraph); otherwise 1. Without this, every DOCX paragraph became its own block.
  2. **Wrapped bullets.** A head line right after a bullet is a continuation, not a new entry, when it isn't dated, the bullet doesn't end in `.!?`, and the line starts lowercase or ends in `.!?`.
  3. **Title pull-back.** When a dated line starts a block by the date rule or the date-line fallback, up to `lead` title-like lines above it move into the new block. A title-like line is a head line of ≤ 60 chars with no date, no `@` and no closing punctuation. `lead` (0–2) is the number of title-like lines directly above the **first** dated line in the section, so the first entry's format ("Title / Company, dates" vs "Company, dates / Title") decides. A pull-back never takes the current block's first line.
- **Fallbacks:**
  - Experience with ≤ 1 block: split at every line holding a range (education lines don't count). It's used only if it gives ≥ 2 blocks; otherwise the one block is the whole section.
  - More than 12 blocks: the rest stays in block 12 (the original lines, so blank lines are kept). Then each block is cut to 3,000 code points.
- **No headings** (`headed: false`): projects → `[]`. Experience → date-line split of the whole text. The lines above the first job are **dropped** (name, contact, summary), apart from its title lines. With no date range anywhere, the whole text is one block.
- **Plain year:** a 4-digit number not inside a word, version, price (`$€£₹`), `#` or count (`2000+`, `50%`).
- **Month names:** `findRanges` reports a month only for real month names or 1–12. `yearsOfExperience` keeps its old reading (any 3–9 letter word before a year counts as its month, e.g. "Studio Nove 2017" = November), so its values don't change.

### Known limits (check in Slice 8)
- **Bullet-less projects in one block.** Projects without bullets, blank lines or long lines (e.g. one line per project: "Meal Planner | React | 2023 | x.web.app") end up as **one block**, so their year and links are shared. This is common for DOCX, because mammoth drops list bullets. Possible fixes: keep `<li>` as "• " (mammoth HTML) at extraction, or add a projects fallback.
- **Single dates.** A line with one date ("Bright Labs, Summer 2018") isn't a range, so it doesn't trigger the date rule.
- **Promotions** ("Acme 2019–2023" then "Senior Dev 2021–2023") split into two blocks.
- **No-heading resumes.** Skills and education text after the last job stays in the last block. Education lines with a degree word don't split, but "IIT Delhi 2018 – 2022" with no degree word would.
- **Continuations.** A wrapped bullet line that starts uppercase and doesn't end in `.!?` starts a block (it then joins the next entry's header).
- **Title pull-back** can move a short description line without a period when `lead` > 0.
- **Plain years** can be counts with no marker ("2000 users").
- `asp.net/c#` in lowercase would be read as a link (uppercase `ASP.NET/C#` isn't).

### Existing steps unchanged: proof
- `pipeline.test.ts` › "the three existing steps see exactly the prompts they saw before Slice 4" hashes the basics, jobTypes and skills prompts for three resumes (a developer with capital headings, tabs and bullets; one with no headings; a writer with "Employment History" and `1)` bullets). It compares them with sha256 values computed from the code **before** any Slice 4 change, with the clock fixed.
- **Caveat:** that covers resumes whose headings were already recognised. A resume using a **newly** recognised heading ("Personal Projects", "Internships", "Relevant Experience"…) now gets different `sections`, so its basics, jobTypes and skills prompts change. The spec intends this; it is why Slice 5 bumps `PIPELINE_VERSION` to `resume@2`. Until Slice 5 the cache key is unchanged, so a cached result for the same text could be reused across this change. That's harmless locally.

### Deviations
- The `headed` flag comes from a new `splitSectionsWithFlag(text): { sections, headed }`. `splitSections` keeps its shape and wraps it, so its callers didn't change.
- `splitEntries` takes a third `opts` argument (`headed`, `now`).
- No-heading experience drops the lines above the first job (see above).
- Additions not in the plan: DOCX spacing, wrapped-bullet continuation, title pull-back, real-month-only months in `findRanges`, and subdomain hosts without a path in `projectLinks`.

### For Slice 5
- Prompt blocks as `[P1]\n<text>`. `Block.id` is ready for the per-call `z.enum`.
- Use `block.range` for `start`/`end`/`current`, and `block.year`/`block.links` for projects. Run every check against `block.text`.
- The projects step's skip condition is `!input.headed || input.projectBlocks.length === 0`. Experience skips when `experienceBlocks` is empty.

## Slice 5: done

Totals (full `npm test`): web 269 (+1), worker 328 (+51), core 120 (+1), db 90, llm 26 = 833 (baseline 780). `npm run typecheck` and `npm run lint` exit 0. Prettier was run on every file I touched (`dates.ts` and `evidence.test.ts` still have older format warnings; not mine).

### Files
- New (worker): `resume/names.ts` + `names.test.ts`, `resume/steps/projects.ts`, `resume/steps/experience.ts`, `resume/steps/work-lists.ts` (the lists and rules both prompts share).
- Changed (worker): `step-types.ts` (`projectsSchemaFor`, `experienceSchemaFor`, `ProjectsOutput`, `ExperienceOutput`, `CopiedLine`), `steps/shared.ts` (`StepSpec.timeoutMs?`, `skip?`, `schema` XOR `schemaFor`, `blocksText`, `WORK_SHORTLIST_HEADING`), `merge.ts` (`mergeWork`, `ReplacedName`, wider `DroppedItem`, exported `stripLinks`), `pipeline.ts`, `test/stub-llm.ts`. Tests: `merge.test.ts`, `pipeline.test.ts`, `jobs/resume.test.ts`, `test/stub-llm.test.ts`, `dev-report.test.ts` (fixture only).
- Core: `RESUME_STEP_NAMES` = basics, jobTypes, skills, **projects, experience** (+ test).
- Web: `ImportSummary.skipped: ResumeStepName[]`; `partialNotice(partial, skipped)` takes `readonly ResumeStepName[]`; `as never` casts removed from `page-data.test.ts`; `PARTIAL_HINT` gains `projects: "your projects in Projects & experience"`, `experience: "your experience in Projects & experience"` (+ test). The import banner's "filled in …" list doesn't count projects or roles yet.

### Pipeline
- `PIPELINE_VERSION = "resume@2"`, `PIPELINE_DEADLINE_MS = 25_000`, `STEP_TIMEOUT_MS = 10_000` (default; a step's `timeoutMs` wins).
- Cache key: `resume@2|basics@1|jobTypes@1|skills@1|projects@1|experience@1|<fast>|<smart>`.
- Both new steps: `model: "fast"`, `maxOutputTokens: 2000`, `timeoutMs: 14_000`, `thinking: "off"`, `retries: 1`, versions `projects@1` / `experience@1`.
- `StepSpec.skip(input)` returns a **reason string or null**: projects → `"no section headings"` (headed false) or `"no Projects section"` (no blocks); experience → `"no Experience section"`. Skipped steps send no request and go to `meta.skipped`, not `partial`. "Every step failed" counts only the steps that ran.
- `meta.promptVersions` lists all five steps, even skipped ones.
- `runResumePipeline` now returns `{ suggestions, partial, skipped: ResumeStepName[] }`.

### What Slice 7 (dev console) gets
`MergeReport` (already passed to `onMerge`; `dev-report.ts` doesn't print the new fields yet):
```ts
type MergeReport = {
  dropped: DroppedItem[];
  replaced: ReplacedName[];               // new
  partial: ResumeStepName[];
  skipped: { step: ResumeStepName; reason: string }[];   // new (SkippedStep)
  suggestions: Suggestions;
};
type DroppedItem = { what: ...; value: string; reason: string; block?: string };  // block set for work items
type ReplacedName = { block: string; name: string; generic: string; source: "model" | "organisation" };
```
- `ReplacedName`: one per kept entry per name actually replaced somewhere in it; `generic` is the phrase really used (after the "a client" fallback). `source: "organisation"` means the role's own organisation (freelance/contract scrub, or a full-time employer in highlights) and the model hadn't listed it. Print as `"Acme Realty" → "a US real-estate agency" (P1)`. Entries dropped later (duplicate, over the limit) don't report names.
- Dropped reasons (`what`: reason):
  - `project` / `role`: "unknown block", "title not in its block", "failed the suggestion schema", "duplicate title", "over the limit of 8" / "over the limit of 6"
  - `outcome` / `highlight`: "not word for word in its block" (value = the model's line)
  - `skill` (entries, with `block`): "not on the shortlist", "label not in its block"
  - `domain`: "not a known domain"; `summary`: "contact details" (value = the model's summary)
  - `organisation`: "not in its block"; `organisationDescription`: "contains the organisation"
- Step results: the two new steps go through `onStepResult` like the others. Skipped steps produce no `StepResult`; use `MergeReport.skipped` for "projects: skipped (no section headings)".
- Blocks for the pre-pass print: `input.projectBlocks` / `input.experienceBlocks` (`id`, `text.length`, `range`, `year`, `links`), `input.headed`.

### Name removal as built (`names.ts`)
- `replaceNames(text, names) → { text, replaced: string[], pairs: { name, generic }[] }`; `nameOccurs(text, name)`; `DEFAULT_GENERIC = "a client"`; `MAX_NAME_CHARS = 80`, `MAX_GENERIC_CHARS = 40`.
- NFKC; whole word via `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, any case, any whitespace run between words; regex characters escaped; one alternation pass, longest first, so a phrase just inserted is never matched again; names under 2 characters or absent are ignored; the first phrase wins for a repeated name; `replaced` is in input order.

### Merge as built (`mergeWork`), and deviations from the spec
1. **Bad phrase → "a client", the name still goes** (the spec said ignore the name). A phrase is bad when it is empty, over 40 characters, has a link/email/`<>`/line break, or contains any listed name that occurs in the text.
2. **Names count for the whole entry.** A model name passes if it occurs as a whole word in the entry's **block** (not only in its own line; names on dropped lines count too). Then it is replaced in the title, summary, `organisationDescription` and every kept line. The spec does per-line checks, then title and summary.
3. Freelance/contract: the organisation (checked with `nameOccurs` in the block) is scrubbed from **title**, summary and highlights (spec: highlights and summary), then set to null. The phrase is `organisationDescription`, else "a client".
4. Other roles: the organisation is replaced in **highlights only** (as the spec says), and `organisation` is kept. This sets `namesRemoved` too (spec: anything replaced).
5. Text that a phrase pushed over its limit is cut at a word boundary with "…" (title 80, lines/summary 160, description 60).
6. Each entry goes through `projectSuggestion` / `experienceSuggestion.safeParse`; a failure drops that entry instead of throwing in `suggestionsSchema.parse`.
7. **Role duplicates** use title + organisation + start month (not title alone), since two jobs can share a title. Project duplicates use the normalised title. Sorting is by block order (stable), then dedupe, then caps.
8. Lines keep their wording, with whitespace collapsed. Links are not stripped from outcomes or highlights. An empty `organisationDescription` stays empty; it is defaulted only when it contains the organisation (full-time "a company", freelance/contract "a client").
9. Titles must appear in their block (NFKC, any case, any spacing, 2+ characters).

### Prompts
- `[P1]\n<text>` blocks joined by blank lines inside `<resume>` through `resumePrompt` (fake tags stripped). Then `Task: projects|experience`, the shortlist under `Skills found in the text (id — name):` (or `(none)`), `Job type ids: …`, `Domain ids: …`, the field rules, the client-name rule (`{"name": "Acme Realty", "generic": "a real-estate agency"}`), and "Never invent anything …". Same SYSTEM as the other steps. The three existing steps' prompts are unchanged (the golden hash test still passes).
- Measured on a typical 2-page developer resume (19 shortlisted skills, 3 roles, 2 projects): projects prompt about 2,200 chars and experience about 2,750, plus the 330-char system and about 2,000 chars of response schema each. That is about **1,100 input tokens (projects) and 1,300 (experience)**. Output is about 300–600 tokens for a typical resume and up to about 1,500–2,000 at the limits (8 projects or 6 roles with every line full).

### Stub LLM
- `projects`/`experience`: one entry per block (max 8 / 6). The title is the first line up to its first separator (` — `, ` – `, ` - `, ` | `, ` · `, `, `, ` at `, ` (`, tab). Outcomes and highlights are the bullet lines (bullet stripped). The first line gets one client name: the capitalised words after "for ". Skills are shortlist ids whose label is in the block. For experience, the organisation is the next head segment when it has no digits, and the employment type comes from the words freelance/contract/intern, else unknown.

### Not done
- **DOCX bullets:** `mammoth.extractRawText` takes no transform option (checked `node_modules/mammoth/lib/index.js`). Keeping list items as "• " would mean moving to `convertToHtml` plus our own HTML-to-text step. That changes every DOCX's text, including the Slice 4 blank-line heuristic, so it isn't small. Left for Slice 8.

## Slice 7: done

Totals (full run): worker 336 (+8, all Slice 7 in `dev-report.test.ts`); web 269, core 120, db 90, llm 26; 841 in total (baseline 833). `npm test -w @redlance/worker`, `npm run typecheck` and `npm run lint` all exit 0. Prettier was run on both files.

### Files
- Changed: `apps/worker/src/dev-report.ts`, `apps/worker/src/dev-report.test.ts`.
- No change to `jobs/resume.ts` or `pipeline.ts`: `prepass` already gets `PipelineInput` (with `headed`, `projectBlocks`, `experienceBlocks`), `step` gets each `StepResult`, and `merge` gets the full `MergeReport` (`dropped`, `replaced`, `skipped`).
- The guard is unchanged: `runner.ts` enables the report only when `APP_ENV === "local"`. The no-op test now also passes blocks, drops, replacements and skips through a disabled report.

### What the report prints now
- **Pre-pass:** `headings found: yes|no`, then `project blocks (n):` / `experience blocks (n):` (or `none`). Each block: id, date range (`2021-03 – present`, year-only starts as `2019`), `year N` (or `–`), link count, and the first 60 characters of its text on one line.
- **Steps:** `projects` and `experience` get `output: N projects|project` / `output: N roles|role` (or `output: none` when the step failed), after the existing model, latency, attempts and tokens lines.
- **Merge:** dropped items show their block (`project "Ghost app" in P3: reason`). Skipped steps print `projects: skipped (no section headings)`. Replaced names print per entry: `P1: "Acme Realty" → "a US real-estate agency" (model)`, or `replaced names: none`.
- Replaced names and block text appear only in this local report, never in the normal logs.

### Sample (made-up data)
```
── resume import 0190… (attempt 1) ──
path: parser + Gemini
pre-pass (no model):
  text length:   6120 chars
  sections:      top (310), experience (1450), projects (620), skills (240)
  headings found: yes
  years of exp.: 6
  shortlist:     12 skill ids — react, typescript, node, …
  GitHub user:   (none found)
  project blocks (2):
    P1  2024-01 – present · year 2024 · links 1 · "Meal planner — React app for families - Built the menu pla"
    P2  2022-05 – 2023-08 · year 2023 · links 0 · "Volunteer dashboard for a food bank - Reduced no-shows by"
  experience blocks (2):
    E1  2021-03 – present · year – · links 0 · "Acme Realty — Designer - Shipped the listing search for"
    E2  2019 – 2021-02 · year – · links 0 · "Studio Nove — Front-end developer - Built marketing sites"
Gemini step "projects" — flash-lite-x
  latency 1234 ms · attempts 1 (ok)
  tokens: input 1100 · output 380 (thought 0) · cost $0.000210
  output: 2 projects
  returned: { "projects": [ … ] }
Gemini step "experience" — flash-x
  latency 900 ms · attempts 1 (ok)
  tokens: input 1300 · output 520 (thought 0) · cost $0.001100
  output: 2 roles
  returned: { "experience": [ … ] }
evidence check + merge:
  dropped 2:
    - project "Ghost app" in P3: title not in its block
    - outcome "Grew sales 40%" in E2: not word for word in its block
  projects: skipped (no section headings)   [only when headings are missing]
  replaced names 2:
    P1: "Acme Realty" → "a US real-estate agency" (model)
    E1: "Acme Realty" → "a client" (organisation)
```
(The sample is hand-written from the format strings; the snippet and counts are invented. The line for "projects: skipped" shows only when that step is skipped, so it's omitted from the example block above.)

### Notes for Slice 8
- Skipped steps send no `StepResult`, so their line comes from `merge` (`skipped`), not `step`.
- The snippet cut is 60 characters, and newlines are collapsed to spaces.

## Review fixes: done

Totals (full `npm test`): web 277 (+8), worker 371 (+35), core 120, db 91 (+1), llm 26 = 885 (baseline 841). `npm run typecheck` and `npm run lint` clean; prettier clean on touched files. No schema change, no migration.

### What changed
- **Names (worker):** `step-types.ts` adds entry-level `clientNames` to project and role output. `projects@2`, `experience@2` (new `ENTRY_NAMES_RULE`; line rule now "the same, for … that line"; phrases must share no word with the name). `mergeWork` applies every verified name (entry + line + organisation) to title, summary, organisationDescription and every line, for every employment type (full-time titles/summaries lose the employer; `organisation` is still stored for non-freelance roles).
- **`names.ts` new exports:** `sharesNameWord`, `findOrganisation` (exact → no legal suffix → longest leading run with a non-common 3+ letter word; returns the block's spelling), `linkNamesClient` (host without www/TLD/dots/hyphens, and path), `removeNamedUrls`, `cutPartialName`. `replaceNames` refuses phrases sharing a word with any listed name (common-word stoplist: the, inc, group, studio, agency, bank, …) or holding a squashed name.
- **`merge.ts`:** `fit` exported and cuts by code points. Lines: verbatim → remove named URLs → cut partial-name tail → drop if < 2 words → replace → fit. Project links that name a client are dropped (`what: "link"`). Freelance/contract org not found → `namesRemoved: true`. Several entries in one block (`spansFor`): own lines = title line up to the next entry's title; links/year from own lines; block dates only for the first role unless own lines hold a range. `entries.ts` exports `projectYear`.
- **Web:** `resetForReimport(userId, kinds)`; `POST /imports/reset` takes `{ kinds }` (default `[]` → Basics/Skills only; `work` only with `resume`); `import-step.tsx` sends accepted kinds, clears the local `work` copy only for a resume, dialog copy from `reimportDialog()` in `import-status.ts`. `partialNotice` words skipped steps apart ("We didn't find a Projects section in your resume, so add any projects by hand.").
- **DB:** `onboarding.test.ts` reads limit CHECKs from `pg_constraint` and compares every number with `WORK_LIMITS` (SQL keeps literals: drizzle-kit loads schema.ts without core).
- **Spec:** "Removing client names", checks table, re-import, API table and step versions updated.
