# Onboarding, resume and GitHub import — design

Date: 2026-09-29 · Status: draft for review (revised 2026-09-29 after checking it against the code; see "Revisions" at the end)

## Goal

A signed-in user sets up their profile in steps and starts the 5-day trial. They can upload a resume and/or give a GitHub username (optional for everyone, and the only link we ask for: there is no portfolio step); a background worker reads them and **pre-fills** the steps, and the user edits everything before saving. Or they skip the import and fill the steps by hand. Progress is saved when the user clicks **Next** or **Save draft**, and they come back to the step where they left off.

This spec also creates `apps/worker` (the background job runner that ingestion will reuse), the job queue, and the LLM wrapper.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Launch scope | **All freelance job types found on Reddit** (development, design, video, writing, marketing, audio, …), one shared skill taxonomy | Decided 2026-09-29; replaces "one launch niche" |
| Resume understanding | Text extraction (`unpdf` for PDF, `mammoth` for DOCX) **+ Gemini** structured output **+ our validation** | Extraction alone gives raw text; rule-based parsing breaks on real layouts (two columns, "Tech stack" instead of "Skills"). The LLM reads any layout; validation keeps output to known values |
| Where imports run | **Postgres job table (`import_jobs`) + a separate worker process (`apps/worker`)** | Background jobs without S3/SQS; the table is both queue and durable record. Same design runs on EC2 as a second container. SQS only when we have several servers or hundreds of jobs/sec |
| Resume file | **Never kept.** The upload's bytes sit in the job row only until the worker extracts the text (seconds), then the column is set to NULL. Only the extracted text is kept | Less personal data; no S3. Parsing untrusted PDFs happens in the worker, not the web server, so a malicious file can't stall page loads |
| Scanned (image-only) PDFs | Not supported: the job fails with "We couldn't read text from this file", and the user adds skills by hand | Needs the file sent to Gemini; revisit if many users hit it |
| GitHub link | **Optional for everyone**, asked on the Import step, saved on the profile. **No portfolio step** (user decision, 2026-09-29) | A shorter onboarding; job types without GitHub just leave it empty |
| GitHub import | Public REST API with a server token; **no LLM** — languages/topics map to skills | Deterministic, free, fast |
| Saving progress | Only on **Next** (full validation → `completed`) or **Save draft** (light validation → `draft`). No autosave | ~6–12 writes per user instead of one every few seconds |
| Subreddits and alerts | **Not onboarding steps.** Finish connects the user to subreddits picked from their job types, and turns on email alerts to the account email. Viewing and changing subreddits, and connecting Telegram, come later from the dashboard | Keeps onboarding short; still follows "Redlance connects the user to the right subreddits" (product decisions, 2026-09-25) |
| Import status | **Blocking** (decided 2026-09-29): after pressing Import, the user waits on the Import step (Next locked, live stages) until every started import is done or failed; the browser polls `GET /imports/:id` every 1.5 s | Suggestions land before the user edits anything, so what the user types never conflicts with what the model suggests. 4–7 s normally, 20 s cap |
| IDs for new tables | **UUIDv7** generated in code (`uuid` package) | Time-sortable, index-friendly, created without a DB round trip, safe in URLs. Postgres 17 has no built-in `uuidv7()`. `users` keeps its random UUIDs |
| LLM | `packages/llm`: `generateStructured()` with a **Vertex AI** Gemini provider (not the AI Studio API key; decided 2026-09-29) and a fake provider for tests; model per step from env | Google Cloud IAM auth, project quotas as the global spending cap, enterprise data terms. CLAUDE.md: "calls go through our own interface so any task can switch model" |
| Resume analysis | **Three focused Gemini steps in parallel** (Basics, Job types & experience, Skills) after a deterministic pre-pass, with evidence quotes and code-side merge; see "Resume analysis pipeline" | Accuracy (decided 2026-09-29): small prompts and schemas per task beat one big call; parallel keeps the wait at ~the slowest step |

## Repo layout (new and changed)

```
package.json                        dev: db + cache, then web and worker together (concurrently)
packages/core/                      @redlance/core — pure TypeScript + zod, no I/O
  src/taxonomy.ts                   CATEGORIES, SKILLS (id, name, category, aliases, githubLanguages/topics)
  src/subreddits.ts                 seed list: subreddit → categories (general boards for everyone)
  src/onboarding.ts                 STEPS registry, per-step draft/complete schemas, resumeAt(), suggestion schema
  src/ids.ts                        newId() → UUIDv7
packages/llm/                       @redlance/llm — generateStructured(), Vertex AI Gemini + fake providers, price table, timeout + one retry
packages/db/
  src/schema.ts                     + the tables below
  src/jobs.ts                       enqueue, claimNext, complete, fail, requeueStale (the queue)
  src/reference.ts                  syncReferenceData(): upsert taxonomy + subreddits from @redlance/core
  src/migrate-cli.ts                runs migrations, then syncReferenceData
apps/worker/                        @redlance/worker — Node 24, tsx in dev
  src/env.ts                        zod-validated settings
  src/index.ts                      LISTEN + poll loop, concurrency, graceful shutdown
  src/jobs/resume.ts                extract → clean → pre-pass → 3 parallel LLM steps → evidence check → merge → result
  src/resume/…                      extract (pdf/docx + zip guard), clean, sections, prepass, shortlist, steps/*, merge (pure where possible)
  test/eval/                        ~20 labelled resumes + scoring script (accuracy, cost, latency)
  src/jobs/github.ts                GitHub API → suggestions
apps/web/src/
  server/api-route.ts               + validated route params, JSON body size cap
  server/onboarding/service.ts      getState, saveStep, finish (the only code writing these tables from web)
  server/onboarding/prefill.ts      saved data ⊕ import suggestions (pure)
  app/api/v1/onboarding/…           thin routes → service
  app/(onboarding)/onboarding/…     step pages and review page, in their own route group: (app)/layout.tsx
                                    renders the dashboard sidebar for everything under it
  components/onboarding/…           step forms (client components) and the shared useStepForm hook
  proxy.ts                          + protects /onboarding
```

## The steps

| # | Step | Required | Fields (limits enforced by the complete schema) |
|---|---|---|---|
| 1 | **Import** | optional | GitHub username or `github.com/<name>` URL (optional; normalised to the username), resume upload (slice 2). Saved data is `{ githubUsername: string \| null }`; imports themselves live in `import_jobs` |
| 2 | **Basics** | yes | display name (1–60), headline (≤120), job types (1–3 categories), experience level (beginner / intermediate / experienced), country (ISO 3166 alpha-2), time zone (IANA; defaults to the browser's) |
| 3 | **Skills** | yes | taxonomy skills, each core or secondary; custom skills (1–40 chars). ≥1 core, ≤8 core, ≤30 total, no duplicates |
| 4 | **Rates & filters** | yes | minimum rate (0–100 000, 2 decimals), currency (USD / GBP / EUR / INR), hourly / fixed / either, remote only, blocked words (≤50, each ≤40) |
| 5 | **Review → Finish** | — | read-only summary with "Edit" links; Finish |

Each step has two zod schemas in `@redlance/core`, used by the form (instant errors) and the server (enforcement): **complete** (everything above) and **draft** (same field types and size limits, but fields may be empty and minimum counts don't apply).

- Skills and custom skills carry `source` (`manual` / `resume` / `github`, default `manual`) so Finish can record where each came from.
- Skills are **never removed** from `taxonomy.ts`, only flagged `retired`, so IDs in saved steps stay valid in the schemas and as foreign keys. The pickers hide retired skills.
- Time zones are validated with `Intl.DateTimeFormat` (accepts aliases such as `Asia/Calcutta`, which some browsers still report); countries against an ISO 3166 list in core.

### Buttons

| Button | Validates with | Saves as | Then |
|---|---|---|---|
| Next | complete schema | `completed` | next step |
| Save draft | draft schema | `draft` | stay; "Draft saved" |
| Save changes (replaces Save draft on a completed step) | complete schema | `completed` | stay |
| Back | — | nothing | if the form has unsaved edits: Save draft / Discard / Cancel |
| Skip (Import only) | — | `completed`, `{ skipped: true }` | next step |

- Closing the tab with unsaved edits triggers the browser's `beforeunload` warning.
- **Local safety net:** unsaved form values are kept in `localStorage` (`rl:onb:<userId>:<step>`, with the version they were based on). If the page loads with a local copy for the same server version that differs from it, a banner offers "Restore unsaved changes". Cleared on save. Nothing goes to the server.

### Where the user lands

`resumeAt()` (pure, in core): the first step, in order, whose row is missing or is a `draft`; `review` if all are completed. `/onboarding` redirects there. Opening a step *after* `resumeAt` redirects back to it. Rules the server enforces:

- Saving a step (draft or complete) needs every earlier step completed, Import included (Skip completes it): otherwise 409 `STEP_ORDER`.
- A completed step stays completed: a draft save on it is refused (400); the UI only offers "Save changes" there.
- Once `onboarded_at` is set, saves and imports return 409 `ALREADY_ONBOARDED`, and every `/onboarding` URL redirects to `/dashboard`. The check lives in each page, not the layout, because layouts don't re-render on client navigation.

Together these keep one invariant: the completed steps are always a prefix of the step list.

## Database

All new tables reference `users(id) ON DELETE CASCADE` (so test resets and account deletion cascade). New IDs are UUIDv7 from `newId()`.

```
skills                                   reference data, synced from @redlance/core
  id           text PK                   -- "react", "premiere-pro"
  name         text not null
  category     text not null             -- "development", "design", "video", …
  aliases      text[] not null default '{}'
  retired      boolean not null default false   -- never deleted; retired skills stay valid on old profiles

subreddits                               reference data, synced from @redlance/core
  name         text PK                   -- lowercase, no "r/"
  categories   text[] not null           -- '{}' = general board, suggested to everyone
  active       boolean not null default true

onboarding_steps
  user_id      uuid → users, step text, PRIMARY KEY (user_id, step)
  status       text  CHECK in ('draft','completed')
  data         jsonb CHECK (pg_column_size(data) <= 65536)
  version      int not null default 1
  updated_at   timestamptz not null default now()
  CHECK step in ('import','basics','skills','rates')

import_jobs                              the queue and the record of every import
  id           uuid PK (v7)
  user_id      uuid → users
  kind         text CHECK in ('resume','github')
  status       text CHECK in ('queued','running','done','failed') default 'queued'
  stage        text CHECK in ('queued','reading','analysing','checking','done','failed') default 'queued'  -- shown to the user
  content_hash text                      -- SHA-256 of the cleaned text (resume jobs); result cache key with pipeline_version
  pipeline_version text                  -- e.g. resume@1
  file_bytes   bytea                     -- upload only; NULL once text is extracted (or the job fails)
  file_type    text                      -- 'pdf' | 'docx'
  input        jsonb not null            -- { filename, size } or { username }
  source_text  text                      -- extracted resume text (≤ 30 000 chars)
  result       jsonb                     -- suggestions (schema v1), never edited afterwards
  error_code   text                      -- NO_TEXT, UNSUPPORTED_FILE, GITHUB_NOT_FOUND, LLM_FAILED, …
  attempts     int not null default 0
  run_after    timestamptz not null default now()
  locked_at    timestamptz
  created_at, finished_at
  INDEX (status, run_after) WHERE status = 'queued'
  INDEX (user_id, created_at)
  INDEX (content_hash, pipeline_version) WHERE status = 'done'

profiles                                 written once, by Finish
  user_id      uuid PK → users
  display_name, headline, categories text[], experience_level, country, time_zone
  github_username text null                -- from the Import step; drafts can link it
  min_rate_minor int, currency text, rate_type text, remote_only boolean, blocked_words text[]
  onboarded_at timestamptz not null, trial_ends_at timestamptz not null
  created_at, updated_at

profile_skills   user_id, skill_id → skills, level ('core'|'secondary'), source ('manual'|'resume'|'github'), PK (user_id, skill_id)
custom_skills    id, user_id, name, name_normalized, level, source, UNIQUE (user_id, name_normalized)
user_subreddits  user_id, subreddit → subreddits… (see note), source ('auto'|'user'), PK (user_id, subreddit)
alert_channels   id, user_id, kind ('email'|'telegram'), target, enabled, verified_at, UNIQUE (user_id, kind)
llm_usage        id, user_id (nullable), task, step (nullable), prompt_version, model, input_tokens,
                 cached_input_tokens, output_tokens, cost_micros bigint, latency_ms, attempt, outcome
                 ('ok'|'timeout'|'error'|'invalid_output'), import_job_id (nullable), created_at
```

- `user_subreddits` is filled by Finish from the seed list (every general board, plus the boards for the user's job types; `source = 'auto'`). `subreddit` is plain text, not a foreign key, so the later dashboard feature can let users add subreddits outside the seed list. Ingestion (next spec) decides which to poll.
- `alert_channels` gets one row at Finish: `email`, enabled, `target` = the account email. Telegram rows arrive with the dashboard feature.
- `profile_skills.skill_id` is a foreign key; custom skills live in `custom_skills` so we can review popular ones and promote them into the taxonomy.
- Reference data: `npm run db:migrate` applies migrations, then `syncReferenceData()` upserts `skills` and `subreddits` from `@redlance/core` (never deletes; missing rows are marked `retired` / inactive). Test setup runs the same.
- Rows in `onboarding_steps` are kept after Finish (they show where users drop off). `import_jobs.source_text` is kept so we can re-run a better prompt later.

## Import pipeline

```
Browser ─POST /imports/resume (multipart)─▶ web: size ≤ 5 MB, magic bytes %PDF- or PK.., quota
                                            INSERT import_jobs (queued, file_bytes) + pg_notify
        ◀──────────── 202 { jobId } ────────┘
worker ◀─ NOTIFY (or 5 s poll) ─ claimNext() ─▶ extract text ─▶ file_bytes = NULL
                                                ─▶ LLM (Gemini) ─▶ validate ─▶ result, status = done
Browser ─GET /imports/:id every 1.5 s─▶ { status, suggestions } → the steps pre-fill
```

### Queue (`packages/db/src/jobs.ts`)

- **Enqueue** (web): insert, then `SELECT pg_notify('import_jobs', id)` in the same transaction.
- **Claim** (worker):
  ```sql
  UPDATE import_jobs SET status = 'running', attempts = attempts + 1, locked_at = now()
  WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' AND run_after <= now()
              ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```
- **Fail:** retryable errors (network, timeout, LLM 429/5xx) set `status = 'queued'`, `run_after = now() + 2^attempts × 5 s` (with jitter) while `attempts < 3`; otherwise `failed` with an `error_code`. Non-retryable errors (NO_TEXT, UNSUPPORTED_FILE, GITHUB_NOT_FOUND) fail at once. `file_bytes` is cleared on every terminal outcome.
- **Stale sweep** (every 60 s): `running` jobs with `locked_at` older than 2 minutes go back to `queued` (or `failed` at 3 attempts). Each job has a 90 s time budget, so a live job never looks stale.

### Worker (`apps/worker`)

- One dedicated `pg` client runs `LISTEN import_jobs` (reconnects with backoff); a pool serves queries. It also polls every 5 s, so a missed notification only delays a job.
- Runs up to `WORKER_CONCURRENCY` (default 4) jobs at once; jobs mostly wait on Gemini/GitHub.
- On SIGTERM/SIGINT: stop claiming, wait up to 30 s for running jobs, exit. Anything cut off is picked up by the stale sweep.
- Logs with pino (one line per job: id, kind, status, attempts, duration). Never logs resume text or file names.

### Resume job

1. **Extract:** PDF via `unpdf` (first 10 pages), DOCX via `mammoth`; normalise whitespace; cap at 30 000 characters. Fewer than 200 characters → fail `NO_TEXT`. Parse error → `UNSUPPORTED_FILE`.
   - **Zip-bomb guard (DOCX):** before `mammoth` opens the file, read the zip's central directory and refuse (`UNSUPPORTED_FILE`) if the total uncompressed size is over 20 MB, any entry is over 10 MB, or there are more than 1 000 entries.
   - **Clean the text:** after extraction, strip invisible and control characters (Unicode `Cf`/`Cc` except `\n` and `\t`: zero-width spaces and joiners, bidi overrides such as U+202E, soft hyphens) and normalise to NFKC. This runs before the text is stored in `source_text` and before it reaches the LLM, so hidden instructions can't ride along in invisible characters.
2. **Deterministic pass:** find a GitHub username in the text (`github.com/<name>`) with a regex.
3. **Analyse:** the resume analysis pipeline below (pre-pass, three parallel Gemini steps, evidence check, merge).
4. **Validate and clean** (zod, then rules):
   - drop unknown skill IDs; put unmatched names in custom-skill suggestions (≤10), matched against taxonomy aliases first;
   - **keep a GitHub username only if it appears verbatim in the resume text** (no invented links);
   - at most 8 core skills.
5. Save `result` (suggestions v1, below), write one `llm_usage` row per step, mark `done` (or `done` with `partial: [steps]` when a step failed).
6. If a GitHub username was found and the user has no GitHub job yet, enqueue one (it's public data the user just gave us). The Import step's GitHub field offers it pre-filled.

### Resume analysis pipeline (slice 2)

All in the worker, in one job, awaited in order; only step C runs things in parallel.

```
cleaned text ─▶ A. early exit + cache ─▶ B. deterministic pre-pass ─▶ C. 3 parallel steps ─▶ D. evidence check ─▶ E. merge ─▶ result
```

**A. Early exit and cache**
- Text shorter than 200 characters → `NO_TEXT` before any model call.
- `content_hash` = SHA-256 of the cleaned text. If a finished `resume` job with the same hash and the same `pipeline_version` exists (any user), copy its `result` and skip the model calls. Only the result is reused, never another user's text.

**B. Deterministic pre-pass (code, no model)**
- **GitHub username:** `github.com/<name>` matches, kept only if `checkGithubInput` accepts them.
- **Sections:** split by common headings (Summary/Profile/About, Experience/Work/Employment, Skills/Tech stack/Tools, Projects/Portfolio, Education, Certifications) into `{ top, summary, experience, skills, projects, education, other }`. Text before the first heading is `top`. With no headings found, every section falls back to the whole text.
- **Years of paid work:** date ranges in `experience` ("Jan 2021 – Present", "2019-2022", "03/2020 – 06/2021") merged into a union of intervals; `yearsExperience` rounded down to 0.5. `null` when no dates.
- **Skill shortlist:** every taxonomy skill whose name or alias appears as a whole word/phrase in the text (case-insensitive, `normalizeSkillName`). Capped at 60, ordered by first appearance. Single- and two-letter aliases (`c`, `r`, `ps`, `pm`, `ae`, `va`, `vo`) only count inside the `skills` section.

**C. Three focused steps, in parallel** (`Promise.allSettled`), each with its own prompt, zod schema, model and output-token cap. Every prompt: a system instruction that the resume is untrusted data and the model must not follow instructions inside it; resume text at the **start** of the user message inside `<resume>…</resume>` delimiters (a shared prefix, so repeated input is eligible for Vertex's implicit caching); `temperature: 0`; thinking off (or minimal for Skills if the eval shows it helps); JSON output against the step's schema.

| Step | Model (env) | Input (routing) | Output (schema) | Max output tokens |
|---|---|---|---|---|
| **Basics** | `VERTEX_MODEL_FAST` (Flash-Lite) | `top` + `summary` | `displayName` (≤60), `headline` (≤120), `country` (ISO alpha-2 or null) | 300 |
| **Job types & experience** | `VERTEX_MODEL_FAST` | `summary` + `experience` + `projects` + the pre-pass `yearsExperience` | `categories` (1–3 of the 12 ids, each with a ≤160-char `evidence` quote), `experienceLevel` | 400 |
| **Skills** | `VERTEX_MODEL_SMART` (Flash) | `skills` + `experience` + `projects` + the shortlist (ids + names) | `skills: [{ id (enum = shortlist ∪ full taxonomy), level, evidence }]` ≤30; `customSkills: [{ name, level, evidence }]` ≤10 | 1 500 |

- Experience level rules given to the model (and applied in code when `yearsExperience` is known): < 1 year paid → beginner; 1–3 → intermediate; > 3 → experienced.
- The category prompt lists the 12 categories with their one-line hints.

**D. Evidence check (code)**
- Each skill, custom skill and category must carry an `evidence` quote that appears in the cleaned text (case- and whitespace-insensitive, ≥ 3 characters). Items without matching evidence are dropped.
- A skill from the shortlist whose name/alias appears in the `skills` section is kept even without evidence (the text itself is the evidence).

**E. Merge (code)**
- Basics fields from step 1, `categories` + `experienceLevel` from step 2, skills from step 3; GitHub username from the pre-pass.
- Skills: unknown ids dropped; unmatched names mapped through taxonomy aliases first, else custom (≤10); duplicates merged (highest level wins); at most 8 core (extra core → secondary, by order); ≤30 total.
- Output is suggestions v1 (below) plus `meta: { pipelineVersion, promptVersions: { basics, jobTypes, skills }, partial: StepName[] }`.

**Reliability**
- Each step: 10 s timeout; on timeout, 429 or 5xx, **one** retry after 1 s; then the step is marked failed.
- Whole job: 20 s hard deadline from the start of step C.
- A failed step doesn't fail the job: the others' results are saved and the failed step is listed in `meta.partial` (the UI says which part to fill in by hand). The job fails only if all three steps fail (`LLM_FAILED`) or the project quota is exhausted (`LLM_BUSY`, shown as "Resume import is busy right now").

**Budget guards**
- Per-step max output tokens (table above); input already capped at 30 000 characters and cut further by routing.
- Per user: 5 resume imports a day (Redis quota, fails closed).
- Global: a Vertex AI **request quota** on the Google Cloud project (hard cap) plus a billing budget alert. A quota 429 maps to `LLM_BUSY`.

**Prompt and pipeline versions**
- Each step has a version constant (`basics@1`, `jobTypes@1`, `skills@1`) and the pipeline one (`resume@1`); they are stored in `result.meta` and on every `llm_usage` row. Prompt text lives in git.

**Evaluation**
- `apps/worker/test/eval/`: about 20 labelled resumes (~14 generated across the 12 job types, layouts and levels, safe to commit; ~6 real ones with consent, anonymised, kept outside git in `test/eval/private/`). Each has `expected.json`: job types, experience level, must-have skills, must-not skills.
- `npm run eval -w @redlance/worker` runs the pipeline against Vertex and prints per-resume and total: skill precision/recall, category accuracy, level accuracy, cost, latency. It can also run a one-call baseline for comparison.
- **LangSmith only for eval runs** (`LANGSMITH_TRACING=true` in the eval command); production never sends resume text to LangSmith. `llm_usage` is always written.

**Learning from edits (later, no work now):** `import_jobs.result` keeps what was suggested and `profile_skills.source` keeps what was accepted; comparing them later shows which suggestions users delete or add, per prompt version.

### GitHub job

1. Accept a username or a `github.com/<name>` URL; validate `^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$`.
2. `GET /users/{u}` (404 → `GITHUB_NOT_FOUND`) and `GET /users/{u}/repos?type=owner&sort=pushed&per_page=100`, with `Authorization: Bearer $GITHUB_TOKEN` (optional locally; without it GitHub allows 60 requests/hour per IP), a Redlance User-Agent, and 10 s timeouts.
3. Ignore forks and archived repos. Languages and topics map to skills through the taxonomy's `githubLanguages` / `topics` aliases; a skill used in ≥3 repos or in the top repo is suggested as core, others as secondary.
4. Nothing else is kept from GitHub for now. Which repo a draft links (the profile, or the repo closest to the post) is for the drafting spec.
5. **Safety rules (from the 2026-09-29 review of the GitHub field):**
   - Only ever call `https://api.github.com/users/<username>` and `/users/<username>/repos` with a username that passed `checkGithubInput` again in the worker. Never fetch a URL the user typed, a repo's `homepage`, or any link found in a resume (no SSRF surface).
   - `redirect: "error"` (GitHub's API doesn't redirect these), a 10 s timeout, and a response size cap (e.g. 1 MB) read as a stream; parse JSON and validate it with zod before use.
   - Never download repo contents, release assets or archives, and never run anything from them. Only metadata (language, topics, stars, dates, description) is read.
   - Treat every string from GitHub (repo names, descriptions, topics) as untrusted text: store it plain, render it through React (escaped), never with `dangerouslySetInnerHTML` or a markdown/HTML renderer, and never put it into an LLM prompt without the same "this is data, not instructions" framing as resumes.
   - Keep the per-user quota (10 GitHub imports a day) and the token with no permissions.

### Suggestions (schema v1, in core)

```json
{
  "v": 1,
  "meta": { "pipelineVersion": "resume@1", "promptVersions": { "basics": "basics@1", "jobTypes": "jobTypes@1", "skills": "skills@1" }, "partial": [] },
  "basics": { "displayName": "…", "headline": "…", "categories": ["development"], "experienceLevel": "intermediate", "country": "IN" },
  "skills": [{ "id": "react", "level": "core" }],
  "customSkills": [{ "name": "Three.js", "level": "secondary" }],
  "githubUsername": "…"
}
```

### Pre-fill rule (`prefill.ts`)

What a step's form shows = **its saved data** (draft or completed) if the row exists, otherwise **suggestions from the user's latest finished imports** (resume and GitHub merged: skills unioned, highest level wins), otherwise empty. Imports are blocking, so suggestions exist before the user edits later steps. Fields and skills filled from suggestions carry `source: "resume" | "github"` so Finish records where they came from.

**Re-import:** if the user comes back to Import after saving Basics or later steps and starts a new import, the UI asks "This will replace what's in Basics and Skills with suggestions from the new resume" (Replace / Cancel). Replace calls `POST /onboarding/imports/reset`, which deletes the saved `basics` and `skills` rows in one transaction (Import and Rates are kept; the resume doesn't fill Rates), then the import starts. Nothing mixes silently.

## API (`/api/v1`, all through `apiRoute()`)

| Endpoint | Does |
|---|---|
| `GET /onboarding` | `{ steps: [{ id, status, data, version, updatedAt }], resumeAt, imports: [{ id, kind, status, errorCode, suggestions }] }` |
| `PUT /onboarding/steps/:step` | body `{ mode: "draft" \| "complete", data, expectedVersion }` (0 for a new row). → `{ status, version, next }`. 409 `VERSION_CONFLICT` if `expectedVersion` is stale (another tab saved); 409 `STEP_ORDER`; 400 with field errors |
| `POST /onboarding/imports/resume` | multipart field `file`, ≤5 MB, PDF/DOCX by magic bytes (not by extension). Quota 5/day. → 202 `{ jobId }` |
| `POST /onboarding/imports/github` | `{ username }` (username or URL). Quota 10/day. → 202 `{ jobId }` |
| `GET /onboarding/imports/:id` | `{ status, stage, errorCode, suggestions, partial }`; `stage` is `queued` → `reading` → `analysing` → `checking` → `done`/`failed` (written by the worker); 404 unless it's the caller's job |
| `POST /onboarding/imports/reset` | Deletes the saved `basics` and `skills` step rows (for Replace). 409 `ALREADY_ONBOARDED` after Finish |
| `POST /onboarding/finish` | See below. → `{ redirect: "/dashboard" }` |

- Saving a step is one statement: insert when `expectedVersion = 0` (`ON CONFLICT DO NOTHING`), otherwise `UPDATE … WHERE user_id = $1 AND step = $2 AND version = $3`; zero rows → 409.
- `apiRoute()` gains a `params` option: Next 16 passes `{ params: Promise<…> }` as the handler's second argument; the wrapper awaits it and validates it with a zod schema (invalid → 404). Order: session → origin → params → input → rate limit.
- JSON bodies over 256 KB are refused with 413 before parsing (`Content-Length` first, then the text length). The resume route leaves `input` unset and reads `request.formData()` itself after checking `Content-Length`; a missing `Content-Length` (chunked upload) is refused.
- New error codes: `VERSION_CONFLICT` (409), `STEP_ORDER` (409), `ALREADY_ONBOARDED` (409), `PAYLOAD_TOO_LARGE` (413) in slice 1; `UNSUPPORTED_FILE` (415) in slice 2.
- **Finish**, in one transaction: lock the user row (`SELECT … FOR UPDATE`), return early if `profiles.onboarded_at` is set (a double click can't restart the trial), re-validate every step's saved data with its complete schema, write `profiles` and the child tables (`source` records manual/resume/github), connect the auto-picked subreddits, add the email alert channel, set `onboarded_at = now()` and `trial_ends_at = now() + 5 days`.

## Pages

- `/onboarding` → redirect to `/onboarding/<resumeAt>`. `/onboarding/[step]` for the four steps and `review`. A focused layout: logo, "Step N of 5" progress, no dashboard sidebar. Pages load state through the service on the server (no HTTP round trip); forms are client components.
- Import step: drop zone (PDF/DOCX, 5 MB; upload progress via `XMLHttpRequest.upload.onprogress`), the GitHub field, and an **Import** button. While any started import is queued/running, **Next and Skip are locked** and a panel shows the live stage ("Uploading…", "Reading your resume…", "Finding your details…", "Checking results…"). On done: "We filled in … Check them on the next steps."; on partial: which part to fill in by hand; on failure: a plain reason and the choice to try another file or continue manually.
- Polling: every 1.5 s while an import is queued/running (keeps polling in a hidden tab so the result is ready on return). The worker's 20 s job cap bounds the wait.
- Leaving mid-import is fine: the job finishes in the worker and the Import step shows the result on return.
- Dashboard: the "Set up your profile" card links to `/onboarding` with "Continue setup · step N of 5"; hidden once onboarded. `proxy.ts` protects `/onboarding` like `/dashboard`.

## Settings

Web: no new variables. Worker (`apps/worker/.env.local`, from `.env.example`):

| Variable | Notes |
|---|---|
| `APP_ENV`, `DATABASE_URL`, `LOG_LEVEL` | as in web |
| `LLM_MODE` | `vertex` or `fake`. `fake` only allowed with `APP_ENV=local` |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | required when `LLM_MODE=vertex` (e.g. `global` or `us-central1`) |
| Google credentials | Application Default Credentials: locally `gcloud auth application-default login`; on EC2, Workload Identity Federation from the AWS role (no key files), or a service-account key from AWS Secrets Manager as a fallback. The service account has only `roles/aiplatform.user`. **No AI Studio API key.** |
| `VERTEX_MODEL_FAST` | Flash-Lite model for the Basics and Job-types steps; default chosen at build time from the Vertex model list (e.g. `gemini-3.5-flash-lite`) |
| `VERTEX_MODEL_SMART` | Flash model for the Skills step (e.g. `gemini-3.8-flash`) |
| `LANGSMITH_*` | eval runs only |
| `GITHUB_TOKEN` | optional locally (warns once); required outside `local`. A fine-grained token with no permissions |
| `WORKER_CONCURRENCY` | default 4 |

## Costs

Onboarding adds no AWS infrastructure: the worker shares the server; Gemini runs on Vertex AI in a Google Cloud project. Resume import: three steps, about 1.5–2× the input of a single call thanks to routing, the shortlist and Flash-Lite for two steps; roughly 2–4¢ per resume, once per user (≈ $20–40 per 1 000 users). GitHub import has no LLM cost. Every LLM call is recorded in `llm_usage` with its cost, step and prompt version.

## Security and privacy

- Uploads: size checked from `Content-Length` before reading and again on the file; type by magic bytes; parsed only in the worker, with a page cap, a time budget and the DOCX zip-bomb guard.
- **Worker container (deployment spec must set these):** runs as a non-root user with a read-only filesystem (a small tmpfs for scratch); memory and CPU limits (e.g. 512 MB, 1 CPU) so a runaway parse can't starve the web container; outbound network only to Postgres, the Gemini API and api.github.com; parser libraries (`unpdf`, `mammoth`) kept updated.
- Prompt injection: the LLM has no tools and no secrets in its prompt; resume text is cleaned of invisible characters, delimited and labelled as data; output is schema-constrained with a max-token cap, validated, and only ever shown as suggestions the user edits. The same "data, not instructions" rule applies wherever profile text later feeds a prompt (drafting).
- Links in resumes are never fetched or visited by the server. Only a GitHub username is kept (verbatim in the text, then `checkGithubInput`); other URLs are dropped.
- The resume file is never stored beyond extraction; resume text is never logged.
- LLM output is untrusted: schema-constrained, validated, links kept only if present in the source text, and only ever shown as suggestions.
- GitHub calls go only to `api.github.com` with a validated username (no user-supplied URLs are fetched, so no SSRF surface in this spec).
- Every job and step is scoped to the session's user; other users' job IDs return 404.
- **Deploy note:** AWS WAF's common rule set blocks request bodies over 8 KB (`SizeRestrictions_BODY`). The deployment spec must exempt `POST /api/v1/onboarding/imports/resume`; the app's own cap (5 MB) still applies. Step saves stay well under 8 KB (the biggest, Skills, is about 3 KB at its limits).

## Testing

- **Unit (core):** each step's draft/complete schemas; `resumeAt()`; suggestion merging; GitHub username parsing; taxonomy integrity (unique IDs and aliases, every skill in a known category).
- **Unit (worker):** text cleaning, zip-bomb guard, section splitting, date-range → years, skill shortlist, evidence check, merge rules (unknown IDs dropped, invented usernames dropped, core cap, partial results), per-step retry/timeout classification; GitHub mapping from fixture API responses.
- **Eval (manual, against Vertex):** the labelled resume set with accuracy, cost and latency per step; not part of `npm test`.
- **Integration (db):** claim with `SKIP LOCKED` — two concurrent claimers never get the same job; stale sweep; `file_bytes` cleared on done and on failure; reference-data sync is idempotent.
- **Integration (web routes):** save draft / complete / version conflict / step order; Finish writes every table, is idempotent, and starts the trial once; upload rejects big and fake files and enforces the quota; import status is private to its owner.
- **End to end (local):** worker with `LLM_MODE=fake` processes a real sample PDF and DOCX from `apps/worker/test/fixtures`.

## Build order

Three slices, each ending with passing tests:

1. **Manual onboarding:** `packages/core`, schema + reference data, step API, pages, Finish, dashboard link. `import_jobs` and `llm_usage` are not created yet; the Import step shows "coming soon" and Skip.
2. **Worker + resume import:** queue, `apps/worker`, `packages/llm`, `import_jobs` + `llm_usage` migration, upload route, Import step, pre-fill.
3. **GitHub import.**

## Out of scope

Cognito, sending alerts, the dashboard pages for subreddits and alert channels (including Telegram linking), matching and "first matches" (the dashboard keeps its empty state), a profile-editing page after onboarding, scanned-PDF support, Behance and other imports, a portfolio step (dropped 2026-09-29 in favour of the GitHub link), checking that subreddits exist (ingestion spec), the worker's Dockerfile (deployment spec), plans and payments.

## Revisions (2026-09-29)

Checked against the code before planning:
- Onboarding pages moved to their own `(onboarding)` route group: `(app)/layout.tsx` wraps its children in the dashboard sidebar.
- `apiRoute()` params are a Promise in Next 16; the wrapper now validates them. JSON bodies get a 256 KB cap.
- Import step data defined; `source` added to skills; skills are retired, never removed.
- Step rules made explicit (saves need earlier steps completed; completed steps can't go back to draft; `ALREADY_ONBOARDED`).
- `import_jobs` and `llm_usage` move to slice 2's migration.
- **Portfolio step removed** (user decision): the Import step asks for an optional GitHub link instead, saved as `profiles.github_username`. Steps are now Import → Basics → Skills → Rates & filters → Review (5). `portfolio_items` is gone, and so are the GitHub/resume portfolio suggestions. CLAUDE.md rule 6 is updated to match.
