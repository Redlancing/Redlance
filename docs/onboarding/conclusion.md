# Onboarding (profile setup, resume and GitHub import): conclusion

**Status (2026-10-17):**
- Slices 1–3 are built:
  - slice 1: the manual steps;
  - slice 2: the worker and resume import;
  - slice 3: GitHub import.
- They live on `feat/onboarding`. `feat/ingestion` is stacked on top and contains all of it. Neither is merged to `main`.
- **Not done yet:**
  - a click-through in a real browser;
  - a live run of the resume eval.

## In one paragraph

After signing in, a new user goes through five pages: **Import → Basics → Skills → Rates & filters → Review**.
- **Import** is optional. Upload a resume (PDF/DOCX) and/or give a GitHub username. A background **worker** reads them, and Gemini turns the resume into suggestions that pre-fill Basics and Skills.
- Each step is saved to the database when the user clicks **Next** (or **Save draft**), so they can leave and come back.
- **Finish** turns the saved steps into a real `profiles` row (plus skills and an email alert channel) and starts the **5-day trial**.

That profile is what matching will compare job posts against.

## The big picture

```
 Browser (/onboarding/[step])                 Next.js API (/api/v1/onboarding/…)           Postgres
 ───────────────────────────                  ─────────────────────────────────           ────────
 Basics/Skills/Rates form ──PUT steps/:step──► saveStep() ─────────────────────────────► onboarding_steps
 Import: resume file ──────POST imports/resume► check size+type, quota 5/day ──INSERT──► import_jobs (+ NOTIFY)
 Import: GitHub name ──────POST imports/github► check name, quota 10/day ─────INSERT──► import_jobs (+ NOTIFY)
 poll every 1.5 s ─────────GET imports/:id ───► getImport() ◄──────────────────────────── import_jobs.result
 Review → Finish ──────────POST finish ───────► finishOnboarding() ────────────────────► profiles, profile_skills,
                                                                                         custom_skills, alert_channels
                                                         ▲
 apps/worker (separate Node process)                     │ claims jobs, writes result
 runner ─► resume job: extract text (thread) ─► clean ─► pre-pass ─► 3 Gemini calls ─► checks ─► merge
        └► github job: api.github.com user + repos ─► map languages/topics to skills
```

## Where the code is

| Layer | Files | What's there |
|---|---|---|
| Shared rules (`@redlance/core`) | `packages/core/src/onboarding.ts` | Step ids, the **draft** and **complete** zod schema for each step (used by both browser and server), limits, `resumeAt()`, `checkGithubInput()` |
| | `taxonomy.ts` | 12 job types and 185 skills with aliases and GitHub language/topic hints. Skills are **retired, never deleted**, so saved profiles stay valid |
| | `suggestions.ts` | The suggestions v1 shape that imports produce, `mergeSuggestions()` (resume wins over GitHub), `suggestedStepData()` |
| | `countries.ts`, `ids.ts` | ISO country list and default currency; `newId()` = UUIDv7 (time-ordered ids) |
| Database (`@redlance/db`) | migrations `0002_onboarding`, `0003_imports`, `0004_drop_blocked_words` | Tables below |
| | `packages/db/src/jobs.ts` | The import job queue |
| | `packages/db/src/reference.ts` | `syncReferenceData()` copies skills (and the subreddit catalogue) into the DB on `db:migrate` |
| Web server | `apps/web/src/server/onboarding/service.ts` | `saveStep()`, `finishOnboarding()`, `getOnboardingState()`: the **only** code that writes onboarding data |
| | `imports.ts` | Start a resume or GitHub import, read one, reset Basics/Skills for a re-import |
| | `page-data.ts` | What each page shows: saved data, otherwise import suggestions, otherwise empty (the "pre-fill rule") |
| | `trial.ts` | Days left in the trial |
| API | `apps/web/src/app/api/v1/onboarding/**/route.ts` | See "API" |
| Pages | `apps/web/src/app/(onboarding)/onboarding/page.tsx`, `[step]/page.tsx`, `layout.tsx` | `/onboarding` sends you to the first unfinished step; `[step]` renders one page and blocks skipping ahead |
| Components | `apps/web/src/components/onboarding/` | One file per step (`import-step.tsx`, `basics-step.tsx`, `skills-step.tsx`, `rates-step.tsx`, `review-step.tsx`), the shared form hook `use-step-form.ts`, import polling `use-import-jobs.ts`, `local-copy.ts`, `progress.tsx`, … |
| Worker | `apps/worker/src/index.ts`, `runner.ts`, `jobs/resume.ts`, `jobs/github.ts`, `resume/*`, `github/*` | Picks up import jobs and runs them |
| Model client (`@redlance/llm`) | `packages/llm/src/vertex.ts`, `generate.ts`, `prices.ts` | Gemini on Vertex AI, structured output checked by zod, retries, cost per call |

## The tables

| Table | Holds |
|---|---|
| `onboarding_steps` | One row per user per step (`import`, `basics`, `skills`, `rates`): `status` (draft/completed), `data` (jsonb, ≤ 64 KB), `version` (for conflict detection) |
| `profiles` | Written once at Finish: name, headline, job types (1–3), experience, country, time zone, `github_username`, min rate (stored in minor units, e.g. cents), currency, rate type, remote only, `onboarded_at`, `trial_ends_at` |
| `profile_skills` | `(user_id, skill_id)`, `level` (core/secondary), `source` (manual/resume/github). `skill_id` references `skills` |
| `custom_skills` | Skills not in the taxonomy, unique per user by normalised name |
| `skills` | Copy of the taxonomy from core (`retired` flag) |
| `alert_channels` | Finish adds `email` (verified). Telegram comes later |
| `import_jobs` | The job queue: `kind` (resume/github), `status` (queued/running/done/failed), `stage` (reading/analysing/checking…, shown live in the UI), `file_bytes` (deleted once read), `source_text`, `content_hash`, `result` (suggestions), `error_code`, `attempts`, `run_after`, `locked_at` |
| `llm_usage` | One row per model attempt: task, step, prompt version, model, tokens, cost, latency, outcome. **Never the text.** Shared with ingestion |
| `user_subreddits` | Not written by onboarding any more (see "Changed since the design") |

## Flow 1: filling in a step and clicking Next

1. `use-step-form.ts` checks the form in the browser with the step's **complete** schema. If it fails, errors show next to the fields and nothing is sent.
2. `PUT /api/v1/onboarding/steps/basics` with `{ mode: "complete", data, expectedVersion }`.
3. `apiRoute()` checks the session, origin, size and rate limit (see the foundation conclusion).
4. `saveStep()` runs in one transaction:
   1. Lock the user row (`FOR SHARE`), so Finish can't run at the same time.
   2. Refuse if already onboarded, or if this step is ahead of the first unfinished one (`STEP_ORDER`).
   3. Check the data again with the same schema. **The server never trusts the browser.**
   4. Write with **optimistic locking**: `UPDATE … SET version = version + 1 WHERE version = expectedVersion`. If no row changed, another tab saved first, so return `409 VERSION_CONFLICT` and don't overwrite it.
5. The browser goes to the next page. That page loads its data with `page-data.ts`: the saved row, otherwise suggestions from imports, otherwise empty.

**Save draft** saves with the looser draft schema and stays on the page. While you type, a copy is kept in `localStorage` (`rl:onb:<user>:<step>`), so a crash or closed tab doesn't lose edits. A banner offers to restore it.

## Flow 2: resume import

1. On the Import step the user drops a PDF/DOCX and clicks Import. If Basics/Skills already have answers, a dialog asks before replacing them.
2. `POST /api/v1/onboarding/imports/resume`. The web server checks, in this order:
   1. `Content-Length` is present and ≤ 5 MB;
   2. the body is multipart;
   3. the **magic bytes** say PDF (`%PDF-`) or DOCX (`PK…`). The file name and extension aren't trusted.
   4. Only then does it take a quota slot (5 a day).
   - The web server **never parses the file**.
3. `enqueueImportJob()` inserts an `import_jobs` row and runs `pg_notify('import_jobs', id)` in the **same transaction**, so the worker only hears about committed jobs. The response is `202 { jobId }`.
4. The browser polls `GET /imports/:id` every 1.5 s and shows the stage ("Reading your resume…", "Finding your details…"). The Import step is locked while it runs. After 60 s it offers "Continue without waiting".
5. **Worker:**
   1. `runner.ts` wakes on the NOTIFY (or a 5 s poll).
   2. It claims the job with `FOR UPDATE SKIP LOCKED`: several workers can pull from one table without taking the same job.
   3. Up to 4 jobs run at once, each with a 90 s limit.
6. `jobs/resume.ts`:
   1. **Extract text in a separate thread** (`worker_threads`, 256 MB heap, killed after 20 s). A hostile file can only crash that thread.
      - PDF: first 10 pages, with `unpdf`.
      - DOCX: the zip is checked strictly (central directory, real decompressed sizes, at most 20 MB in total) and **rebuilt** before `mammoth` reads it. This stops zip bombs and malformed zips.
   2. **Clean** the text: Unicode normalisation, strip invisible characters, cap at 30,000 characters.
   3. **Delete the file bytes** and keep only the text. The file itself is never kept.
   4. Fewer than 200 characters means `NO_TEXT`, for example a scanned PDF.
   5. **Cache:** hash the text. If the same text was already analysed by the same pipeline, prompt and model versions, reuse that result.
   6. **Pre-pass, no AI:**
      - split into sections (summary, experience, skills…);
      - work out years of experience from date ranges;
      - build a **skill shortlist** by matching taxonomy names and aliases;
      - find a GitHub username in the text.
   7. **Three Gemini calls in parallel**, each with a 10 s timeout and one retry, all within 20 s:
      - **Basics** (Flash-Lite): name, headline, country.
      - **Job types** (Flash-Lite): categories with evidence, plus experience.
      - **Skills** (Flash, the smarter model): skill ids with evidence, plus custom skills.
      - The resume goes into the prompt as untrusted data inside `<resume>` tags.
   8. **Evidence checks:** each category and skill must come with a quote that really appears in the resume. A skill's quote must also contain the skill's name. Anything without evidence is dropped. This is how invented skills are kept out.
   9. **Merge** into suggestions v1.
      - Experience level is computed from the years if known.
      - Emails and phone numbers are dropped from the name.
      - Limits: 8 core skills, 30 skills in total.
      - If one call failed, the result is marked `partial` and not cached.
   10. If the resume links a GitHub profile, a GitHub job is queued automatically.
   11. Save the result and mark the job done.
   - Every write is **fenced** (`WHERE status='running' AND attempts=<my claim>`). A worker that timed out and was replaced can't overwrite the newer attempt.
   - Errors retry with backoff (≈5 s, ≈10 s; 3 attempts), then fail with an `error_code` the UI turns into a message.
7. When every import has settled, the page refreshes. Basics and Skills have no saved rows yet, so they show the suggestions. Imported skills keep `source: resume|github`.

## Flow 3: GitHub import

1. The user types a username or a github.com link. `checkGithubInput()` accepts only `github.com` profile links and refuses reserved pages like `/settings`.
2. When the user leaves the field, the **browser** asks `api.github.com` whether the account exists. Our server never fetches what users type at that point.
3. `POST /imports/github` checks the name, takes the quota (10 a day) and queues a job.
4. The worker (`jobs/github.ts`, `github/client.ts`):
   1. Calls only two URLs: `api.github.com/users/<u>` and `/users/<u>/repos`.
   2. Refuses redirects and caps the body at 1 MB.
   3. Ignores forks and archived repos.
   4. Maps languages and topics to skills (`github/map.ts`). A skill becomes **core** if it appears in 3+ repos or in the top repo.
   5. Job types can only be development and/or games.
   - **No AI is used.**
5. Suggestions merge with the resume's. The resume wins on Basics, and skills are combined.

## Flow 4: Finish

1. The Review page only opens when all four steps pass their complete schemas.
2. `POST /finish` → `finishOnboarding()` runs in one transaction:
   1. Lock the user row (`FOR UPDATE`).
   2. If a profile already exists, just redirect. A double click is harmless.
   3. Check every step again.
   4. Insert `profiles` (trial ends 5 days from **now**: the trial starts at Finish, not at sign-up), `profile_skills`, `custom_skills`, and an `email` alert channel.
   5. In the same transaction, grant the trial's 210 draft credits (`grantPlanCredits(tx, userId, "trial", trialEndsAt, now)`): a `credit_balances` row ending at `trial_ends_at` and a `grant` ledger row. If Finish fails, the grant rolls back with it.
3. The user lands on `/dashboard`. The dashboard shows "Your trial: N days left". From then on, every `/onboarding` URL redirects to the dashboard, and the API answers `ALREADY_ONBOARDED`.

The dashboard card before Finish reads "Start setup", or "Continue setup · step N of 5".

## API

Every route goes through `apiRoute()`.

| Method and path | Does | Returns |
|---|---|---|
| `GET /api/v1/onboarding` | Current state | Steps (data and version), `resumeAt`, `onboardedAt`, latest imports |
| `PUT /api/v1/onboarding/steps/:step` | Save a step | `{status, version, next}`; 409 `VERSION_CONFLICT` / `STEP_ORDER` / `ALREADY_ONBOARDED`; 400 field errors |
| `POST /api/v1/onboarding/finish` | Create the profile and start the trial | `{redirect: "/dashboard"}` |
| `POST /api/v1/onboarding/imports/resume` | Upload (multipart, ≤ 5 MB, PDF/DOCX) | `202 {jobId}`; 411/413/415/429/503 |
| `POST /api/v1/onboarding/imports/github` | `{username}` | `202 {jobId}` |
| `GET /api/v1/onboarding/imports/:id` | Poll one import (only your own) | status, stage, suggestions, error |
| `POST /api/v1/onboarding/imports/reset` | Clear Basics/Skills before applying a new import | 204 |

## The model layer (`@redlance/llm`)

- **Vertex AI only:** `new GoogleGenAI({ vertexai: true, project, location })`. The worker refuses to start if `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set. Credentials come from `gcloud auth application-default login` (a key file via `GOOGLE_APPLICATION_CREDENTIALS` also works, with a warning).
- `generateStructured()`:
  - turns a zod schema into a JSON schema so Gemini must answer in that shape;
  - checks the answer with zod again;
  - retries timeouts, rate limits, server errors and invalid output once;
  - returns a record of every attempt (tokens, cost, latency) for `llm_usage`.
- **Models:**
  - `VERTEX_MODEL_FAST` = `gemini-3.5-flash-lite` (resume Basics and Job types; ingestion).
  - `VERTEX_MODEL_SMART` = `gemini-3.8-flash` (resume Skills).
- **Prices** live in `prices.ts`. The Flash-Lite numbers are **unverified placeholders**. The gemini-3.8-flash price is introductory until 2026-12-31.
- **First real resume** (2026-09-29): 6.8 s, about $0.0036.

## Decisions worth remembering (and why)

- **Every freelance job type, with one shared skill taxonomy.** Development, design, video, writing and the rest, instead of launching with one niche.
- **UUIDv7 ids for new tables.** They sort by creation time, which keeps indexes compact. Postgres 17 has no built-in v7, so `newId()` makes them.
- **Save only on Next or Save draft, no autosave.** It is simpler, and a draft can't silently replace a completed step.
- **One schema in core, used by the browser and the server.** The two can't drift apart.
- **The queue lives in Postgres, not SQS.** One less service. `SKIP LOCKED` plus `LISTEN/NOTIFY` is enough at this size.
- **The worker is a separate process.** Slow, risky work (parsing untrusted files, 10–20 s model calls) never blocks the web server.
- **Resume files are never stored, only their text.** Less to leak.
- **Evidence-checked AI output.** Suggestions must be backed by quotes from the resume, so the model can't pad the profile.
- **No portfolio, voice, subreddit or blocked-words step.** These were user decisions. GitHub is optional on Import, and voice will be learned from edits.

## Changed since the design (`design.md`)

`design.md` is the original spec; this file describes the code. Where they differ:

- **Finish no longer connects subreddits.** Migration `0005` deleted the auto rows, and `user_subreddits` now only allows `source = 'user'`, for a later paid feature. Everyone's feed comes from the central catalogue (ingestion).
- **"Skip for now" doesn't save a skip marker.** It is Next with an empty GitHub field.
- **No `prefill.ts`.** The pre-fill rule is in `page-data.ts` plus core `suggestions.ts`.
- **Only the file size is stored with a job**, not the file name.
- **The cache key holds every version:** `resume@1|basics@1|jobTypes@1|skills@1|<fast>|<smart>`. Partial results are never cached.
- **Evidence quotes are stricter:** ≥ 12 characters or ≥ 2 words.
- **The browser gives up waiting after 60 s** (with an escape button). The worker job limit is 90 s.
- **Added beyond the design:**
  - the extraction thread;
  - the DOCX rebuild;
  - fenced writes;
  - abort on shutdown;
  - the browser GitHub check;
  - the restore banner;
  - dev-only console reports of each import.
- **Blocked words were removed** (migration `0004`).
- **The worker also runs ingestion now** (poller and analyser), in the same process.

## Tests

Tests use stubs only and never call Vertex or GitHub. The stub model is `apps/worker/test/stub-llm.ts`, built on `createFakeTransport`.

| Area | Test files (tests) |
|---|---|
| core | `onboarding` 26, `suggestions` 8, `taxonomy` 13, `ids` 2 |
| db | `jobs` 16 (the queue), `onboarding` 9 |
| llm | `generate` 13, `vertex` 7, `prices` 5 |
| web | API `onboarding` 6 + `imports` 17; server `service` 12, `page-data` 10, `imports` 4, `trial` 1; components about 50 |
| worker | `runner` (claiming, timeouts, shutdown, retries), `env`, `db` (NOTIFY listener, poller lock), `jobs/resume`, `jobs/github`, `github/client` 10, `github/map` 3, and one file per resume stage: `extract` (incl. the zip guard), `clean`, `dates`, `sections`, `prepass`, `evidence`, `merge`, `pipeline`; plus `stub-llm`, `dev-report` and resume eval scoring |

**Whole repo (2026-10-17): 601 tests pass** (web 226, worker 216, core 82, db 51, llm 26), and typecheck and lint are clean.

Commit `5645aeb` had deleted the worker tests above (about 108) and `scripts/vertex-check.ts`. The cause was that commit `a61bd1b` moved the fake model to `test/stub-llm.ts` without updating the tests that imported it, so they stopped compiling. They were restored on 2026-10-17:
- pointed at `stubResumeResponder`;
- `env.test.ts` rewritten for the current settings, including ingestion's;
- `db.test.ts` now holds both the listener test and the lock tests.

`npm run vertex:check -w @redlance/worker` works again.

## Known gaps

- No click-through in a real browser yet (only curl).
- The resume eval (`npm run eval -w @redlance/worker -- --baseline`, 14 synthetic resumes) has not been run live.
- Scanned (image-only) PDFs fail with `NO_TEXT`. There is no OCR.
- A resume-found GitHub job is only queued if the user has **never** had a GitHub job.
- After 3 retries (≈ 20 s each plus backoff), a failing import can outlast the browser's 60 s wait.
- `design.md` mentions sample PDF/DOCX fixtures for an end-to-end test. They don't exist.
- The skill and subreddit lists still need the user's review.

**Deferred minor items** (from the reviews; none block merge):
- **UX:**
  - Enter doesn't submit a step (there is no `<form>`).
  - Editing from Review goes Next → the following step, not back to Review.
  - Progress bars show position, not completion.
  - Client navigation (progress links, logo) skips the leave dialog; the local copy still saves edits.
  - Focus is lost when the skills list fills or a chip is removed.
  - Disabled job-type chips drop out of the tab order.
  - The country code shows for a moment before its name.
- **Form hook:**
  - `pending` resets before navigation, so a fast double click sends a second save.
  - Back isn't disabled mid-save.
  - `STEP_ORDER` and `ALREADY_ONBOARDED` only refresh, with no notice.
  - The hook's save and conflict logic has no tests.
- **A11y:**
  - Progress rows are about 22px tall on mobile.
  - No "(completed)" text for screen readers.
  - Add `role="list"` for Safari.
  - Some hints aren't linked by `aria-describedby`.
- **Server:**
  - A client abort mid-body logs a 500.
  - `getOnboardingState` runs two queries with `Promise.all` on one transaction client, which breaks under pg@9.
  - The rate limit runs after reading up to 256 KB.
  - The API accepts retired skill ids.
  - Finish's re-validation of bad saved data isn't tested.
  - The finish-vs-save race test is timing-based.
- **Data:**
  - Taxonomy `group()` can't mark a skill `retired` yet; fix that before retiring one.
  - 1–2 letter aliases (c, r, ps, pm…) are risky for free-text matching.
  - `parseGithubUsername` accepts `github.com/orgs|settings`.
  - The "GMT" and "EST5EDT" time zones are refused.
  - No DB CHECKs on profile country, GitHub username or lengths (app-validated only).
  - `sqlList` uses `sql.raw` (trusted constants only).
- **Tests:**
  - The countries test only checks the count.
  - The "edit" ranking test depends on taxonomy order.
  - Some core helpers are untested.

## How to run it

```sh
npm run db:up && npm run db:migrate     # tables + skills copied in
npm run dev                             # web + worker
# sign in at /login (any email in dev), then open /onboarding
```

For resume import the worker needs Google credentials:
1. Create a Google Cloud project and enable the Vertex AI API.
2. Run `gcloud auth application-default login`.
3. In `apps/worker/.env.local`, set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION=global`. The Gemini 3.x models return 404 in `us-central1`.

Each import prints a step-by-step report in the worker console (local only).
