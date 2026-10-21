# Onboarding (profile setup, resume and GitHub import): conclusion

**Status (2026-10-21):** built and merged to `main` (merge `2f37612`, 2026-10-19), including projects & experience (slices 1–7 of `projects-experience-plan.md`). This file was re-checked against the code on `feat/insights` (which holds `feat/alerts` and `feat/ui`) on 2026-10-21. The onboarding test files pass, apart from one test-database leftover (see "Tests"). **Not done yet:** a click-through of onboarding in a real browser, a live run of the resume eval, and the user's check on real resumes (slice 8).

## In one paragraph

After signing in, a new user goes through six pages: **Import → Basics → Skills → Projects & experience → Rates & filters → Review**.
- **Import** is optional. Upload a resume (PDF/DOCX) and/or give a GitHub username. A background **worker** reads them: Gemini turns the resume into suggestions, GitHub's API is read without AI. The suggestions pre-fill Basics, Skills and Projects & experience.
- Each step is saved to the database when the user clicks **Next** (or **Save draft**), so they can leave and come back. Nothing is saved while typing, except a copy in the browser's `localStorage`.
- **Finish** turns the saved steps into the real profile (`profiles` plus skills, projects, roles and an email alert channel), starts the **5-day trial**, grants the trial's **210 draft credits** and asks the matcher to look at the **last 3 days** of posts.

That profile is what matching, drafting and alerts use from then on. Changes after Finish go through the profile edit page (`docs/onboarding/profile-edit.md`), which reuses the same field components and schemas.

## Architecture

```
Browser (/onboarding/[step])                Next.js (one server)                           Postgres
──────────────────────────                  ────────────────────                           ────────
page load ─────────────────────────────────► [step]/page.tsx → loadOnboardingPage() ◄──── onboarding_steps,
                                              (saved row, else import suggestions)          import_jobs.result
Basics/Skills/Work/Rates ─PUT steps/:step──► apiRoute → saveStep() ──────────────────────► onboarding_steps
Import: resume ───────────POST imports/resume► size + type checks, quota 5/day ─INSERT+NOTIFY► import_jobs
Import: GitHub name ──────POST imports/github► name check, quota 5/day ─────────INSERT+NOTIFY► import_jobs
re-import accepted ───────POST imports/reset ► delete Basics/Skills(/Work) rows ───────────► onboarding_steps
poll every 1.5 s ─────────GET imports/:id ───► getImport() ◄─────────────────────────────── import_jobs
Review → Finish ──────────POST finish ───────► finishOnboarding() (one transaction) ───────► profiles, profile_skills,
                                                                                            profile_projects,
                                              Redis: daily quotas + rate limits             profile_experience, credit_*,
                                                                                            alert_channels
                                                       ▲ claims a job, writes the result
apps/worker (separate Node process)                    │
runner ─► resume job: extract text (own thread) ─► clean ─► pre-pass ─► up to 3 Gemini calls ─► checks ─► merge
       └► github job: api.github.com user + repos ─► map languages/topics to skills (no AI)
```

- **The web server never parses a file and never calls Gemini or GitHub.** It checks the upload, stores it in a job row and answers `202`. The slow, risky work runs in the worker.
- **The queue is a Postgres table** (`import_jobs`). The web server inserts a row and sends `pg_notify` in the same transaction; the worker wakes on the notification (or a 5 s poll) and claims the row with `FOR UPDATE SKIP LOCKED`.
- **Pages read Postgres directly on the server** (`page-data.ts`); client components only call the API to save, import or poll.
- **One set of schemas** (`@redlance/core`) checks the data in the browser, in the API and again at Finish.

## The user's journey, step by step

1. **From the dashboard.** A signed-in user without a profile sees the "Set up your profile" card (`OnboardingCta`) on the dashboard and the other app pages: "Start setup", or "Continue setup · step N of 6". Login never sends anyone to onboarding by itself.
2. **`/onboarding`** sends you to the first step that's missing or still a draft (`resumeAt()`); with all five steps complete, to Review. Every `/onboarding/*` page first runs `loadOnboardingPage()`: signed out → `/login`, already onboarded → `/dashboard`, a step **ahead** of `resumeAt` → back to `resumeAt` (you can't skip ahead, but you can go back to any earlier step).
3. **Import** ("Let's set up your profile"). Everything is optional.
   - Drop a PDF or .docx (≤ 5 MB) and/or type a GitHub username, `@name` or a github.com link. When the GitHub field loses focus, **the browser** asks `api.github.com/users/<name>` whether it exists (5 s timeout, no cookies, no referrer); only a 404 shows "not found", anything else stays quiet. Our server never fetches what users type.
   - **Import** starts both jobs at once. If Basics, Skills or Projects & experience already have saved answers, a dialog asks first ("Replace Basics, Skills, and Projects & experience?"; a GitHub-only import only replaces Basics and Skills). After the server accepts the import, the browser calls `POST /imports/reset` so the old answers make way for the new suggestions.
   - While it runs: "Uploading N%…", then "Getting ready…", "Reading your resume…", "Finding your details…", "Checking results…". The step and the progress bar are locked. After 60 s it shows "This is taking longer than expected." with **Continue without waiting**.
   - When every import has settled, the page refreshes and shows a summary ("Done — we filled in your basics, 2 job types and 14 skills…", or what to add by hand when part of it failed). A GitHub link found in the resume fills the GitHub field.
   - The button reads **Skip for now** when there's nothing to import, otherwise **Next**. Import has no Back and no Save draft.
4. **Basics:** display name (required, ≤ 60), headline (≤ 120), 1–3 job types (of 12), experience level, country and time zone (pre-set to the browser's zone).
5. **Skills:** search the 185-skill taxonomy (names and aliases) or pick from "Popular for your job types" (from the saved Basics). Only taxonomy skills can be added: Enter adds the typed skill or the first result starting with the text, and a search with no result shows "No matching skill. Try another name." At most 30 skills in total and 8 core; at least 1 core. The first 3 added default to core. Imported skills keep `source: resume|github`.
6. **Projects & experience** (`/onboarding/work`), all optional ("Skip for now" when both lists are empty).
   - Up to 8 projects (title and a one-line summary required; role, kind, skills, job types, domains, up to 3 outcomes, up to 3 links, year) and 6 roles (title and a short description of the organisation required; employer name optional and removed for freelance/contract roles, dates, up to 4 highlights).
   - Each card has Edit, Remove and **Use in replies** (off = `hidden`). A "Client name removed. Check nothing is left." note shows on cards where the importer removed a client's name.
   - **Mention employer names in replies** is off by default.
7. **Rates & filters:** minimum rate (0 = any budget, ≤ 100,000, 2 decimals), currency (USD/GBP/EUR/INR; default from your country), hourly/fixed/either, remote only.
8. **Review** ("Check and finish") opens only when all five steps pass their full checks; otherwise it sends you to the first one that fails. It summarises each step with an Edit link and says "Finishing starts your 5-day trial." Once every step is complete, each step page also shows **Back to review**.
9. **Finish** → `POST /api/v1/onboarding/finish` → you land on `/dashboard`, which now shows "Your trial: N days left" and the matches. Every `/onboarding` URL now redirects to the dashboard, and the onboarding API answers `409 ALREADY_ONBOARDED`.

## Saving a step

**In the browser** (`use-step-form.ts`):
1. The step's `prepare` runs (Basics fills the time zone; Import turns the GitHub text into a bare username). Then the data is checked with the step's **complete** schema (Next) or **draft** schema (Save draft). If it fails, the errors show next to the fields, focus moves to the first bad one, and nothing is sent.
2. `PUT /api/v1/onboarding/steps/<step>` with `{ mode, data, expectedVersion }`.
3. On success the local copy is deleted and Next goes to the `next` page from the response. On a completed step, Save draft becomes **Save changes** (fully checked, the step stays complete).
4. **Local copy:** 400 ms after each edit, the form is copied to `localStorage` (`rl:onb:<userId>:<step>`, with the version it was based on). Next time the page opens, a banner offers "Restore them" if the copy belongs to the same version and differs from what's saved. Leaving with unsaved changes: Back asks "Save your changes first?"; closing the tab shows the browser's warning.
5. **Stale page guard** (`stale-step.ts`): on load, and when the browser restores the page from its back/forward cache, the form asks `GET /api/v1/onboarding` and refreshes if this step changed in another tab.

**On the server** (`saveStep()` in `service.ts`), one transaction:
1. Lock the user row `FOR SHARE` (Finish takes `FOR UPDATE`, so a save and Finish can't interleave).
2. Refuse with `409 ALREADY_ONBOARDED` if a profile exists, and `409 STEP_ORDER` (with `resumeAt`) if this step is ahead of the first unfinished one.
3. Refuse a draft save on a completed step (`400`; the browser sends "complete" there).
4. Check the data again with the same schema. **The server never trusts the browser.** Failures return `400 INVALID_INPUT` with a per-field list the form maps back onto its fields.
5. Write with **optimistic locking**:
   ```sql
   -- first save
   INSERT INTO onboarding_steps … ON CONFLICT DO NOTHING RETURNING version;
   -- later saves
   UPDATE onboarding_steps SET data = …, status = …, version = version + 1
   WHERE user_id = … AND step = … AND version = <expectedVersion> RETURNING version;
   ```
   No row back means another tab saved first: `409 VERSION_CONFLICT`. The browser then keeps your edits and says "This step was saved in another tab. Reload to get the latest version — your edits here will be offered back."

**What a page shows** (`page-data.ts`, the "pre-fill rule"):
- a saved row for the step (draft or complete) → that, read with the draft schema (if it no longer parses, empty, not suggestions);
- no row → import suggestions: the latest **done** resume job merged with the latest **done** GitHub job (resume first). Import gets the GitHub name, Basics the name/headline/job types/level/country, Skills the skills, Projects & experience the projects and roles (resume only);
- Rates never gets suggestions; its currency defaults from the saved country.

This is why re-importing deletes the Basics/Skills/Work rows (`/imports/reset`): with a row there, suggestions are never shown.

## Resume import

**Web server** (`startResumeImport()` in `server/onboarding/imports.ts`), in this order:
1. Refuse if already onboarded (409).
2. `Content-Length` must be present (411) and ≤ 5 MB + 64 KB of multipart overhead (413).
3. The body must be `multipart/form-data` (400), is counted again while reading (413), and must hold a non-empty `file` ≤ 5 MB.
4. The **magic bytes** must say PDF (`%PDF-`) or DOCX (`PK\x03\x04`), else `415 UNSUPPORTED_FILE`. The file name and extension aren't trusted, and the file name isn't stored.
5. **Only now** take a quota slot: 5 resume imports per user per UTC day (Redis key `q:{u:<id>}:resume_import:<date>`). The quota **fails closed**: if Redis is down the answer is `503 UNAVAILABLE`, because each import costs model calls.
6. `enqueueImportJob()` inserts the job (file bytes, type, size) and runs `pg_notify('import_jobs', id)` in the same transaction, so the worker only hears about committed jobs. Response: `202 { jobId }`.

**Queue and runner** (`packages/db/src/jobs.ts`, `apps/worker/src/runner.ts`):
- The runner wakes on the notification, a 5 s poll, or a finished job, and claims the oldest due job:
  ```sql
  UPDATE import_jobs SET status = 'running', attempts = attempts + 1, locked_at = now()
  WHERE id = (SELECT id FROM import_jobs
              WHERE status = 'queued' AND run_after <= now()
              ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```
  `SKIP LOCKED` lets several workers pull from one table without taking the same job.
- Up to `WORKER_CONCURRENCY` jobs at once (default 4), each with a 90 s limit. Every later write is **fenced** (`WHERE status = 'running' AND attempts = <my claim>`), so a worker that timed out and was replaced can't overwrite the newer attempt.
- Retryable errors go back to the queue after ≈ 5 s, then ≈ 10 s (3 attempts in total), then fail with an `error_code` the page turns into a message. A sweep every 60 s re-queues jobs stuck running for over 120 s. On shutdown, running jobs are aborted 5 s before the 30 s grace period ends and retried later.

**The resume job** (`apps/worker/src/jobs/resume.ts`, `resume/*`):
1. **Extract text in a separate thread** (`worker_threads`, 256 MB heap, killed after 5 s; was 20 s until 2026-10-21). A hostile file can only crash that thread (→ `UNSUPPORTED_FILE`).
   - The 256 MB cap covers only the JS heap, not ArrayBuffers (what PDF decompression allocates; a test thread capped at 64 MB held 600 MB of them). So the parent polls each thread's heap + ArrayBuffer memory every 50 ms (`worker.getHeapStatistics()`, which a thread answers even mid-way through a synchronous loop) and kills just that thread once it passes 128 MB (`MEMORY_LIMIT_BYTES` in `extract.ts`; a normal resume peaks at ~25–35 MB). It logs `path: "memory"` and fails as `UNSUPPORTED_FILE`. Between two polls a thread can still grow by whatever it allocates in 50 ms.
   - PDF: the first 3 pages, with `unpdf` (was 10 until 2026-10-21; resumes are 1–3 pages).
   - DOCX: the zip's structure is checked strictly for every entry (the central directory must match the local headers, no duplicate names, ≤ 1,000 entries). Only the 12 text parts `mammoth` opens for raw text (`word/document.xml`, styles, numbering, footnotes, endnotes, comments, their `_rels`, the package rels and content types; list in `extract-inline.ts`) are unpacked, once, with real decompressed sizes ≤ 5 MB in total (lowered from 20 MB on 2026-10-21: only text XML counts now); images and every other entry are never unpacked or counted, so a big photo doesn't block a resume. Those parts are **rebuilt** into a clean zip that `mammoth` reads. This stops zip bombs and malformed zips.
2. **Clean** the text: Unicode NFKC, strip invisible and control characters, tidy whitespace, cap at 30,000 characters.
3. **Delete the file bytes** and keep the text in `source_text` until the job ends (a retry reads the text, not the file; it is deleted when the job completes or fails for good). Under 200 characters → `NO_TEXT` (for example a scanned PDF).
4. **Cache:** if the same text (sha-256) was already analysed with the same versions — key `resume@5|profile@1|skills@3|work@1|<fast model>` (the versions plus only the models the calls use, so changing `VERTEX_MODEL_SMART` no longer misses the cache) — and that result wasn't partial, reuse it.
5. **Pre-pass, no AI:** split into sections (`sections.ts`: whole lines ≤ 40 characters, case and a trailing colon ignored, `&` read as "and", letter-spaced headings like "E X P E R I E N C E" and leading emoji icons accepted; a bulleted or numbered line is never a heading, because "– Tech Stack:" inside a project once cut the projects section in two). Recognised: summary; experience (work/professional/relevant/freelance/industry experience, employment/work/career history, internships); skills ("skills" with up to three known words around it, such as "Technical Skills and Interests", "Skills & Tools", "Key Skills", plus tech stack, technologies, tools, core competencies, expertise); projects; education (also certifications, licences, coursework); and **other**, headings we don't read but that must end the section above: achievements, awards, honours, positions of responsibility, leadership, extracurricular, activities, volunteering, publications, interests, hobbies, references. Positions of responsibility, leadership and volunteering go to other, not experience, because the experience list models paid jobs with an employment type. "Languages" is not a heading (under Skills it often lists programming languages). Then work out years of experience from date ranges; build a **skill shortlist** (≤ 60) by matching taxonomy names and aliases; number the lines of the Projects and Experience sections (`entries.ts` `numberSection`: every non-blank line gets `[P1]`, `[P2]`, … or `[E1]`, `[E2]`, …; a blank line stays as one unnumbered empty line so the model still sees the layout; each section is capped at 12,000 characters and 300 lines, then cut with an unnumbered "(the section is cut here)" note; anything in the resume that looks like a line marker, such as `[P5]`, `[ E 2 ]`, `【L3】` or `［P4］`, gets round brackets so it can't pass for a line number); find a GitHub link. Code no longer decides where entries start and end (until `resume@5` it cut the sections into blocks by layout rules, which failed on some layouts).
6. **Up to three Gemini calls in parallel** (five until `resume@3`, 2026-10-21), all on Flash-Lite, within a 25 s deadline, each retried once (`pipeline.ts`, `steps/profile.ts`, `steps/skills.ts`, `steps/work.ts`).

   | Call | Model | Timeout | Max output | Reads | Returns |
   |---|---|---|---|---|---|
   | Profile (`profile@1`) | Flash-Lite | 10 s | 700 | top, summary, experience, projects (each once) | name, headline, country; up to 3 job types with a quote each; experience level |
   | Skills (`skills@3`) | Flash-Lite (was Flash) | 10 s | 1,500 | skills, experience, projects | up to 30 skills with quotes; it sees the shortlist **and** every taxonomy id (unlike post analysis, which only gets the shortlist) |
   | Work (`work@2`) | Flash-Lite | 20 s | 4,000 | the numbered Projects lines in `<projects>` (P1…) and the numbered Experience lines in `<experience>` (E1…) | up to 8 projects and up to 6 roles (asked in the prompt, cut by `merge.ts`; not in the schema, see below), each with `lines: { from, to }`, the first and last line number of that entry |

   - **Prompt layout:** the task comes first (instructions, field rules, the full skill id list, the job types, the domain ids: the same for every user), then the per-resume parts (shortlist, years of experience), then the resume **last**, inside `<resume>` tags. A shared fixed prefix is what Vertex implicit caching reuses; it only starts at 4,096 prompt tokens (6,144 for Gemini 3.8 Flash), more than these prompts have, so for now this is future-proofing.
   - **Untrusted data:** the system message says the resume is untrusted and never to follow instructions in it. Any `<resume>`, `<projects>` or `<experience>` tag in the text is stripped (repeatedly, so a split tag can't rebuild one) before it goes in. The work call's schema is built per resume: line numbers are integers with `minimum: 1` and `maximum: <that section's line count>` (Vertex accepts these, checked live on 2026-10-22; they are sent as a JSON-schema hint through `.meta()`, not as a zod check, so a number past them never fails the call and `merge.ts` checks every range), skills are an enum of the shortlist, and a list is only in the schema when its section has lines.
   - **No `maxItems` on the outer lists:** Vertex answers `400 INVALID_ARGUMENT` ("Request contains an invalid argument") when the top-level `projects` or `experience` list has `maxItems` and its items hold lists with their own `maxItems` (skills, categories, domains, outcomes, client names). Bisected live on 2026-10-21: dropping only the outer limit works, as does keeping it with no nested ones; it isn't plain nesting depth (a small 3-level test schema passed), so it looks like a limit on how far Vertex expands bounded repeats. The nested limits stay; the 8 / 6 limits are in the prompt and `merge.ts` ("over the limit of N"). `step-types.test.ts` checks every call's schema for this shape.
   - **Skips:** the work call leaves out projects without section headings or without a Projects section, and experience without an Experience section (that list and its rules aren't in the prompt or schema); with neither, no work request is sent.
   - **Partial and skipped** still name the five logical parts (`basics`, `jobTypes`, `skills`, `projects`, `experience`), so the web app didn't change: a failed profile call marks `basics` + `jobTypes` partial, a failed work call marks the lists it ran. `meta.promptVersions` holds the three call versions (`{ profile, skills, work }`; older results keyed by step still parse). `llm_usage.step` is the call name.
   - **Timeouts:** the work call writes two lists, so it has 20 s; its retry after a timed-out first attempt gets only the last ~5 s of the deadline and usually ends as a partial result.
   - **Input size** (the 14 eval fixtures, characters ÷ 4, system message included): about 2,300 tokens per resume over 3.9 calls before, about 2,200 over 2.9 calls after.

7. **Checks and merge** (`merge.ts`, `evidence.ts`, `names.ts`): the model suggests, code decides.
   - A job type needs a quote (≥ 12 characters or ≥ 2 words) that really appears in the resume. A skill needs a quote that appears in the resume and names the skill, or must be on the shortlist with its name in the Skills section. Anything else is dropped; this is how invented skills are kept out.
   - Experience level comes from the years when known (< 1 beginner, ≤ 3 intermediate, else experienced). Names with an `@`, digits only or a link are dropped. Limits: 8 core skills, 30 in total.
   - **Line ranges** (`entries.ts` `resolveRanges`, per list): a range that isn't whole numbers, starts outside the section or ends before it starts is not trusted, and the entry is checked against the **whole section** instead (looser, and it gets no dates, year or links, because the section's first ones belong to some other entry); a range that ends past the section is cut at its last line. An entry whose title isn't in its own range is dropped first, so an invented entry can't take lines from a real one. Then the entries are put in line order, and when one starts inside the one before, the earlier one ends just above it (the later entry's first line is its title, which the model is surer of than where the earlier entry ends); of two entries starting on the same line, the later one in the model's list is dropped. Every fix is recorded in the dropped list (`what: "lines"`) for the dev console; drops and replaced names name the entry by its range (`P3–P7`, or `projects` / `experience` for the whole section).
   - Projects and roles: the range's lines are the entry's block. The title must appear in it; skills must be on the shortlist and named in it; outcomes and highlights must be **word for word** from it (a `[P3]` marker the model copies at the start of a value is removed first). Dates (the first date range in the lines), the project year and links (≤ 3) are taken from the entry's own lines by code, not by the model.
   - **Client names:** names the model lists are checked against the entry's lines, then replaced with a generic phrase everywhere in that entry; links naming a client are removed, and the employer is removed for freelance/contract roles. The card is marked `namesRemoved`.
   - The result is the suggestions **v2** shape (`@redlance/core` `suggestions.ts`). If a call failed, the result is marked `partial` (and not cached); if every call failed, the job is retried (`LLM_BUSY` / `LLM_FAILED`).
8. If the resume links a GitHub profile and the user has **never** had a GitHub job, a GitHub job is queued (`fromResume: true`, no quota taken).
9. Save the result; the job is done. One `llm_usage` row is written per model attempt (tokens, cost, latency, outcome; never the text).

**Back in the browser** (`use-import-jobs.ts`): it polls `GET /imports/:id` every 1.5 s (also in a hidden tab). When nothing is running it asks `GET /api/v1/onboarding` once more to pick up a GitHub job the worker started, then refreshes the page.

## GitHub import

1. `checkGithubInput()` (core) accepts `octocat`, `@octocat`, or an http(s) link on `github.com`/`www.github.com` (the first path part is the name, so repo links work). It refuses other hosts, ports, credentials, invalid names and 38 reserved pages (`settings`, `orgs`, `login`, …).
2. `POST /imports/github` checks the name again, refuses if onboarded, takes the quota (5 a day, `github_import`, fails closed), queues a job.
3. The worker (`jobs/github.ts`, `github/client.ts`) calls exactly two URLs, `api.github.com/users/<u>` and `/users/<u>/repos?type=owner&sort=pushed&per_page=100` (first page only, so at most 100 repos). Redirects are refused, each body is capped at 1 MB, each request has 10 s. `GITHUB_TOKEN` is sent when set (required outside local and test). 404 → `GITHUB_NOT_FOUND` (no retry); 429 or a rate-limit 403 → `GITHUB_RATE_LIMITED` (retry).
4. Mapping (`github/map.ts`), **no AI**: forks and archived repos are ignored; each repo's language and topics map to skills through the taxonomy's GitHub hints. A skill is **core** if it's in 3+ repos or in the top repo (most stars, then most recently pushed), at most 8 core and 30 in total. Job types can only be development and/or games. Repos never become projects; projects come only from the resume.
5. Merging (`mergeSuggestions()`): Basics take the resume's value first; skills are combined (core if either source says core); projects and roles come from the resume.

## Finish

`finishOnboarding()` runs in one transaction:
1. Lock the user row `FOR UPDATE`.
2. If a profile already exists, return the redirect without writing, so a double click is harmless.
3. Re-read all five steps and check each with its **complete** schema. Anything missing or invalid → `409 STEP_ORDER` with the step to go back to (the Review page sends you there).
4. Write, in this order:
   - `profiles`: the Basics, the GitHub name, the min rate in **minor units** (`round(minRate × 100)`, e.g. cents), currency, rate type, remote only, `mention_employers`, `onboarded_at = now()`, `trial_ends_at = now() + 5 days`. **The trial starts at Finish, not at sign-up.** Defaults fill `plan = 'trial'`, the alert threshold (70) and daily cap (20).
   - Trial credits: `grantPlanCredits(tx, userId, "trial", …)` → 210 credits in `credit_balances` until `trial_ends_at`, plus a `grant` row in `credit_ledger`. If Finish fails, the grant rolls back with it.
   - `profile_skills`, `profile_projects`, `profile_experience` (in the order shown, with `hidden` kept).
   - `requestRematch(tx, userId, now − 3 days)`: the matcher backfills the last 3 days of posts for the new profile.
   - `alert_channels`: an `email` channel, verified (the user's sign-in email).
5. Return `{ redirect: "/dashboard" }`. `onboarding_steps` and `import_jobs` are left as they are. No `user_subreddits` are written.

## Endpoints

Seven route files, seven handlers, all under `/api/v1/onboarding` and all through `apiRoute()`: IP pre-limit (120 burst, 4/s) → session (401) → origin on writes (403 `BAD_ORIGIN`) → params → input (JSON ≤ 256 KB) → the user's `api` bucket (30 burst, 2/s; 429) → handler. No onboarding route sets its own bucket. Every route answers `409 ALREADY_ONBOARDED` after Finish (except the two reads).

| Method + path | Body | Success | Route-specific errors |
|---|---|---|---|
| `GET /api/v1/onboarding` | — | 200 `{ steps: [{id, status, data, version, updatedAt}], resumeAt, onboardedAt, imports }` | — |
| `PUT /api/v1/onboarding/steps/:step` | `{ mode: "draft"\|"complete", data, expectedVersion }` | 200 `{ status, version, next }` | 400 field errors; 404 unknown step; 409 `VERSION_CONFLICT` / `STEP_ORDER` |
| `POST /api/v1/onboarding/finish` | — | 200 `{ redirect: "/dashboard" }` | 409 `STEP_ORDER` |
| `POST /api/v1/onboarding/imports/resume` | multipart `file` (PDF/DOCX, ≤ 5 MB) | 202 `{ jobId }` | 400, 411, 413, 415, 429 `QUOTA_EXCEEDED`, 503 |
| `POST /api/v1/onboarding/imports/github` | `{ username }` | 202 `{ jobId }` | 400, 429 `QUOTA_EXCEEDED`, 503 |
| `GET /api/v1/onboarding/imports/:id` | — | 200 `{ id, kind, status, stage, errorCode, suggestions, partial, skipped, fromResume, createdAt }` | 404 (not a UUID, or not yours) |
| `POST /api/v1/onboarding/imports/reset` | `{ kinds: ["resume"\|"github"] }` | 204 (deletes Basics + Skills rows, and Work for a resume) | — |

`file_bytes` and `source_text` are never selected for API responses.

## Decisions (and why)

| Decision | Why |
|---|---|
| Every freelance job type, one shared taxonomy (12 job types, 185 skills) | Not limited to one niche; skills are **retired, never deleted**, so saved profiles stay valid |
| One schema per step in core, used by browser, API and Finish | The checks can't drift apart; Finish re-checks in case a limit was tightened |
| Save on Next / Save draft only, plus a browser copy | Simple, and a draft can't silently replace a completed step; the local copy covers crashes and closed tabs |
| Optimistic locking with `version` | Two tabs can't silently overwrite each other; no long-held locks |
| The queue is a Postgres table (`SKIP LOCKED` + `LISTEN/NOTIFY`), not SQS | One less service; plenty at this size (decided 2026-09-29) |
| The worker is a separate process; extraction runs in its own thread | Parsing untrusted files and 10–25 s model calls never block the web server; a hostile file can only crash a thread |
| Check upload size and magic bytes before the quota, quota before the queue | Junk uploads don't use up a user's 5 imports; nothing reaches the worker without a quota slot |
| Quotas fail closed (503), rate limits fail open | A Redis outage must not allow unlimited paid model calls |
| The file is never kept; its text is kept only until the job ends | Less to leak; a retry reuses the saved text, then `completeImportJob`, a final `failImportJob` and the stale-job sweep set `source_text` to NULL. The cache needs only `content_hash` + `pipeline_version` + `result` (`findCachedResumeResult` never reads the text). Migration `0021_delete_resume_text` cleared older rows |
| Evidence-checked AI output | Every job type, skill, outcome and highlight must be backed by the resume's own words, so the model can't pad the profile |
| Flash-Lite for every resume call, three calls instead of five (2026-10-21) | Cheaper and fewer requests; Skills was on Flash until `skills@3`, as the hardest choice (185 ids). The code still checks every quote, so a weaker model can't add unsupported skills, only miss some. Not yet measured with the eval |
| The model picks each entry's lines, code checks them (`work@2`, `resume@6`, 2026-10-22) | Cutting sections into entries by layout rules failed on real resumes (a dash-bulleted list of three projects became one entry; a project cut in two lost the outcomes in its second half). The model reads layout better; code still checks every range (bounds, order, overlap) and every value against the entry's own lines, so a wrong range can only drop or loosen an entry, never add unsupported text. Live (2026-10-22, 4 resumes): every range valid, fixture 02 now gives 3 projects instead of 1, about $0.0003–0.0007 per work call |
| Client names scrubbed, employer names off by default | Freelancers often can't name clients; drafts must not leak them |
| GitHub import uses no AI and only two GitHub URLs | Cheap, predictable, and our server never fetches arbitrary user-supplied URLs |
| The trial starts at Finish | Time spent setting up doesn't eat into the 5 days |
| Finish asks for a 3-day re-match | The first dashboard has matches instead of being empty until new posts arrive |
| No portfolio, voice, subreddit or blocked-words step | User decisions: GitHub is optional on Import, voice is learned from edits, every user gets the central subreddit catalogue |
| UUIDv7 ids (`newId()`) | They sort by creation time, which keeps indexes compact; Postgres 17 has no built-in v7 |

## The pieces and where they live

| Layer | Files | What's there |
|---|---|---|
| Shared rules (`@redlance/core`) | `onboarding.ts` | Step and page ids, draft and complete schemas, `LIMITS`, `resumeAt()`, `checkGithubInput()`, `TRIAL_DAYS` |
| | `work.ts` | Project and role schemas, `WORK_LIMITS`, `checkLink()`, the 30 domains |
| | `suggestions.ts` | Suggestions v2, `mergeSuggestions()`, `suggestedStepData()` |
| | `taxonomy.ts`, `countries.ts`, `ids.ts`, `client-names.ts` | Job types and skills (with aliases and GitHub hints), ISO countries and default currency, `newId()`, client-name helpers |
| Database (`@redlance/db`) | migrations `0002_onboarding`, `0003_imports`, `0004_drop_blocked_words`, `0005_subreddit_catalogue`, `0008_projects_experience` (+ profile columns from `0010`, `0011`, `0012`, `0015`), `0020_drop_custom_skills` | Tables below |
| | `jobs.ts` | The import job queue (enqueue, claim, fenced writes, retry, sweep) |
| | `reference.ts` | `syncReferenceData()` copies skills (and the subreddit catalogue) into the DB on `db:migrate` |
| Web server | `server/onboarding/service.ts` | `saveStep()`, `finishOnboarding()`, `getOnboardingState()`: the only code that writes onboarding steps and the profile at Finish |
| | `imports.ts`, `page-data.ts`, `trial.ts` | Start/read/reset imports; what each page shows; trial days left |
| API | `app/api/v1/onboarding/**/route.ts` | See "Endpoints" |
| Pages | `app/(onboarding)/layout.tsx`, `onboarding/page.tsx`, `onboarding/[step]/page.tsx` | `/onboarding` → first unfinished step; `[step]` renders one page, blocks skipping ahead, guards Review |
| Components | `components/onboarding/` | One file per step (`import-step`, `basics-step`, `skills-step`, `work-step` + `entry-fields` + `work-cards`, `rates-step`, `review-step`); the form hook `use-step-form`, `local-copy`, `stale-step`, `step-actions`; imports: `resume-drop`, `upload`, `use-import-jobs`, `import-status`, `import-lock`, `github-lookup`; `progress`, `skill-search`, `skill-levels` |
| | `components/app/onboarding-cta.tsx` | The "Set up your profile" card on app pages |
| Worker | `apps/worker/src/runner.ts`, `jobs/resume.ts`, `jobs/github.ts`, `resume/*`, `resume/steps/*`, `github/*` | Picks up import jobs and runs them |
| Model client (`@redlance/llm`) | `vertex.ts`, `generate.ts`, `prices.ts` | Gemini on Vertex AI, structured output checked by zod, retries, cost per call |

## The tables

| Table | Holds |
|---|---|
| `onboarding_steps` | One row per user per step (`import`, `basics`, `skills`, `work`, `rates`): `status` (draft/completed), `data` (jsonb, ≤ 64 KB by a CHECK), `version` |
| `import_jobs` | The queue: `kind` (resume/github), `status`, `stage` (queued/reading/analysing/checking/done/failed, shown live), `input` (`{size}` or `{username, fromResume?}`), `file_bytes` + `file_type` (deleted once read), `source_text` (kept only until the job ends: cleared on done and on a final failure or timeout, kept while a retry is queued), `content_hash` + `pipeline_version` (the cache key), `result`, `error_code`, `attempts`, `run_after`, `locked_at`, `finished_at` |
| `llm_usage` | One row per model attempt (task `resume_import`, step, prompt version, model, tokens, cost, latency, outcome). Never the text. Shared with ingestion and drafts |
| `profiles` | Written at Finish (fields above); later features add plan, alert and re-match columns |
| `profile_skills` | `(user_id, skill_id)`, `level` (core/secondary), `source` (manual/resume/github) |
| `profile_projects`, `profile_experience` | Projects and roles with `position`, skills, job types, domains, outcomes/highlights, `source`, `hidden`; length CHECKs in the database |
| `credit_balances`, `credit_ledger` | The trial grant (owned by drafts, `docs/drafts/conclusion.md`) |
| `alert_channels` | Finish adds `email` (verified); Telegram is linked later from Settings (`docs/alerts/conclusion.md`) |
| `skills` | Copy of the taxonomy from core (`retired` flag) |

## The model layer (`@redlance/llm`)

- **Vertex AI only:** `new GoogleGenAI({ vertexai: true, project, location })`. The worker refuses to start if `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set. Credentials come from `gcloud auth application-default login` (a key file via `GOOGLE_APPLICATION_CREDENTIALS` also works, with a warning).
- `generateStructured()` turns a zod schema into a JSON schema so Gemini must answer in that shape, checks the answer with zod again, and retries timeouts, rate limits, server errors and invalid output once (1 s apart). Daily-quota errors, bad requests and aborts aren't retried. Temperature 0, thinking off (minimal; falls back to low for a model that refuses that).
- **Models:** `VERTEX_MODEL_FAST` = `gemini-3.5-flash-lite` (every resume call; also post analysis and drafts). `VERTEX_MODEL_SMART` = `gemini-3.8-flash` (only the draft-eval judge; the resume Skills call moved to Flash-Lite on 2026-10-21).
- **Prices** live in `prices.ts`. The Flash-Lite numbers are **unverified placeholders**; the gemini-3.8-flash price is introductory until 2026-12-31. The only real measurement (6.8 s, about $0.0036, 2026-09-29) is from the old three-call pipeline.

## Changed since the design (`design.md`)

`design.md` is the original spec; this file describes the code. Where they differ:
- **A Projects & experience step was added** (`projects-experience-design.md`); `design.md` has no `work` step.
- **Finish no longer connects subreddits.** Migration `0005` deleted the auto rows; `user_subreddits` only allows `source = 'user'`, for a later paid feature.
- **Finish also grants trial credits and asks for a 3-day re-match** (added by drafts and matching).
- **"Skip for now" doesn't save a skip marker.** It is Next with nothing filled in (Import and Projects & experience).
- **No `prefill.ts`.** The pre-fill rule is in `page-data.ts` plus core `suggestions.ts`.
- **Only the file size is stored with a job**, not the file name.
- **The cache key holds every version**, and partial results are never cached.
- **Evidence quotes are stricter:** ≥ 12 characters or ≥ 2 words.
- **The browser stops waiting after 60 s** (with an escape button); the job limit is 90 s.
- **Added beyond the design:** the extraction thread, the DOCX rebuild, fenced writes, abort on shutdown, the browser GitHub check, the restore banner, the stale page guard, and dev-only console reports of each import.
- **Blocked words were removed** (migration `0004`).
- **No custom skills (user decision, 2026-10-21):** only taxonomy skills; table dropped in migration `0020_drop_custom_skills`; missing skills are added to the taxonomy as names or aliases. Saved Skills rows and stored import results (still suggestions v2) that carry an old `customSkills` key still parse: the schemas drop the key, as the rates step drops `blockedWords`. The resume Skills prompt no longer asks for custom skills (`skills@2`, so the cache key changed).
- **The worker also runs** ingestion, matching, drafts, voice, alerts and the insights refresh, in the same process.

## Tests

Tests use stubs only and never call Vertex or GitHub (the stub model is `apps/worker/test/stub-llm.ts`). Run on 2026-10-21:

| Workspace | Onboarding test files | Result |
|---|---|---|
| core | `onboarding` 32, `suggestions` 16, `work` 25, `taxonomy` 13, `client-names` 6, `ids` 2 | 94 pass |
| db | `jobs` 16, `onboarding` 16, `reference` 7 | 71 pass, **1 fails** (below) |
| llm | `generate` 13, `vertex` 7, `prices` 5 | 26 pass |
| web | API `onboarding` 9, `imports` 19; server `service` 26, `page-data` 19, `imports` 5, `trial` 1; 12 component files (77) | 176 pass |
| worker | `runner` 14, `env` 28, `db` 3, `jobs/resume` 10, `jobs/github` 4, `github/client` 10, `github/map` 3, `resume/` `merge` 55, `names` 29, `pipeline` 29, `entries` 23, `prepass` 20, `extract` 17, `dates` 16, `sections` 11, `clean` 5, `evidence` 5, plus eval scoring | pass (the run's one failure is the drafts eval guard, which fails until the first live draft eval writes `report.json`) |

The db failure: `packages/db/src/onboarding.test.ts` expects exactly 473 subreddit rows, but the shared `redlance_test` database holds 6 extra rows (`alpha`, `beta`, `big`, `small`, `mid`, `dead`) left by another test file. A test isolation problem, not an onboarding bug. Fix: have that test count only catalogue rows, or have the other test clean up.

## Known gaps

**Found in this review (2026-10-21):**
- **The import summary ignores projects and roles.** A resume that yields only projects or roles shows "We couldn't find anything to fill in", even though Projects & experience is pre-filled (`import-status.ts` counts only basics, job types and skills).
- **Work call retries can't fit the deadline:** 20 s + 1 s + 20 s is more than the 25 s pipeline deadline, so a first timeout usually ends as a partial result (projects and experience).
- **The three-call, all-Flash-Lite pipeline (`resume@3` to `resume@6`) hasn't been run through the live resume eval yet** (`npm run eval -w @redlance/worker`).
- **Client names the model doesn't list survive** in a project's title or summary (roles also use the organisation name as a backup; projects have none). The "Client name removed" note only shows when something was removed.
- After "Continue without waiting", polling stops, so results only appear after a reload.
- `llm_usage` logs timed-out attempts with 0 tokens and $0, so it can under-count the Vertex bill.

**Still open from before:**
- No click-through in a real browser; the resume eval (`npm run eval -w @redlance/worker -- --baseline`, 14 synthetic text resumes) hasn't run live; no sample PDF/DOCX fixtures exist.
- Scanned (image-only) PDFs fail with `NO_TEXT`. There is no OCR.
- A resume-found GitHub job is only queued if the user has **never** had a GitHub job (so a second resume with a different link is ignored). GitHub reads only the 100 most recently pushed repos.
- After 3 attempts plus backoff, a failing import can outlast the browser's 60 s wait. A permanent GitHub 403 is retried 3 times.
- Failed imports (for example `NO_TEXT`) still use one of the 5 daily slots.
- The Review page says new matches are **emailed**, but alerts are Telegram; the new wording waits for the user's approval.
- The skill list and the subreddit list still need the user's review.

**Deferred minor items** (from the reviews; none block merge; re-checked 2026-10-21):
- **UX:** Enter doesn't submit a step (no `<form>`). Next from an edited step goes to the following step (Back to review exists now). Progress bars show position, not completion. Progress links and the logo skip the leave dialog (the local copy still saves edits). Focus is lost when a skill chip is added or removed (the work step handles focus). Disabled job-type chips drop out of the tab order. The country code shows for a moment before its name.
- **Form hook:** Back isn't disabled mid-save; `STEP_ORDER` and `ALREADY_ONBOARDED` only refresh, with no notice; the save and conflict logic has no tests.
- **A11y:** progress rows are about 22 px tall on mobile; no "(completed)" text for screen readers; no `role="list"` for Safari; the display name, country and skill-search hints aren't linked by `aria-describedby`.
- **Server:** a client abort mid-body logs a 500; `getOnboardingState` runs three queries with `Promise.all` on one transaction client (breaks under pg@9); the JSON routes' rate limit runs after reading up to 256 KB; the API accepts retired skill ids; no test for Finish with a completed step that a tightened limit now rejects; the finish-vs-save race test is timing-based; a maximum-size Projects & experience step hasn't been measured against the 64 KB row CHECK (would be a 500, not a 400).
- **Data:** taxonomy `group()` can't mark a skill `retired` yet (fix before retiring one); 1–2 letter aliases (c, r, ps, pm…) are risky for free-text matching; the "GMT" and "EST5EDT" time zones are refused; no DB CHECKs on profile country, GitHub username or lengths; `sqlList` uses `sql.raw` (trusted constants only).

Fixed 2026-10-22: resume text is deleted as soon as the job ends (`source_text` and `file_bytes` set to NULL on done, on a final failure and on the stale-job sweep's TIMEOUT; kept only while a retry is queued; migration `0021_delete_resume_text` cleaned existing rows, and the dev db was migrated). Caching is unaffected (it uses the hash). Also fixed 2026-10-22: a double click on Next no longer sends two saves (`use-step-form.ts`: a ref blocks a second save before React re-renders, and the buttons stay disabled until the next page loads; a bfcache restore re-enables them).

Fixed since 2026-10-17: every projects and experience call failed with Vertex `400 INVALID_ARGUMENT` (outer `maxItems` over nested `maxItems`), and only a few headings were recognised, so on a real resume "Technical Skills and Interests", "Positions of Responsibility" and "Achievements" landed in the projects section (skills empty, junk project blocks); both fixed in `resume@4` (2026-10-21). `checkGithubInput()` refuses reserved pages (`github.com/orgs`, `/settings`, …). The GitHub daily quota went from 10 to 5, the same as resumes (2026-10-21). An over-long string never fails a call any more (`resume@5`, 2026-10-22): the call schemas only reject runaway output (`safetyMax(N)` = max(4N, 300) characters, in `step-types.ts`), and `merge.ts` checks the full text first (title in its block, lines word for word, evidence in the text), then trims to the real limit with `fit()` (name, headline, titles, summaries, lines, organisation, organisation description, generic phrases).

## How to run it

```sh
npm run db:up && npm run db:migrate     # tables + skills copied in
npm run dev                             # web + worker
# sign in at /login (any email in dev), then click "Start setup" on the dashboard
```

For resume import the worker needs Google credentials:
1. Create a Google Cloud project and enable the Vertex AI API.
2. Run `gcloud auth application-default login`.
3. In `apps/worker/.env.local`, set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION=global` (the Gemini 3.x models return 404 in `us-central1`).

Each import prints a step-by-step report in the worker console (local only). GitHub import works without a token locally (60 requests an hour per IP).

### What to check in the browser

1. Sign in with a new email → dashboard → **Start setup** → you land on `/onboarding/import`.
2. Type `/onboarding/rates` in the address bar → you're sent back to Import (no skipping ahead).
3. Type a GitHub name that doesn't exist and click elsewhere → "not found" hint. Type `github.com/settings` → refused.
4. Upload a real resume (PDF and, separately, a .docx) → the stages show, then a summary. Basics, Skills and Projects & experience are pre-filled; check that every skill and outcome really comes from the resume and that no client name is left.
5. Upload a renamed `.txt` as `.pdf` → "unsupported file", and the quota isn't used.
6. On Basics, type a name, close the tab, reopen → the restore banner offers your edits.
7. Open Skills in two tabs, save in one, then save in the other → "saved in another tab".
8. Re-import from Import after saving Basics → the replace dialog appears, and the old answers are replaced.
9. Finish → dashboard shows "Your trial: 5 days left" and credits; any `/onboarding` URL now goes to the dashboard.
10. Six imports in one day → the sixth gets "You've reached today's import limit".
