# Phase 11: Review, fixes and handover

Model: **Opus** for the review · **Haiku** for the doc updates · Runs after Phase 10

## Why

Each phase was built by a separate agent. A fresh review of the whole branch catches what no single phase could see: a privacy leak between the evidence and the prompt, a refund path that can run twice, or an API response exposing internal text.

## Steps

### 1. Fresh code review (Opus, a new agent with no build context)

Review `git diff main...feat/drafts` against `docs/drafts/README.md`. Focus on:
- **Money:**
  - can credits be spent twice, refunded twice, or go below 0?
  - can the daily caps be bypassed by concurrent requests?
- **Privacy:**
  - can a hidden entry, an organisation name (employers off), a red flag or `evidenceText` reach the prompt or an API response?
  - is `llm_usage` free of text?
- **Prompt injection:** is post text and the user's instruction always inside its tags, with the tags stripped from the content?
- **Queue:**
  - are claims fenced?
  - is the stale requeue safe?
  - does shutdown lose or duplicate a draft?
- **Rules from CLAUDE.md:**
  - nothing posts to Reddit (rule 1);
  - everything is stored (rule 3);
  - drafts are short and specific with at most one link (rule 6).
- **Spec drift:** any place where the code differs from the README.

Output: findings ranked by severity, each with a failure scenario.

### 2. Fixes (Opus for money/privacy/queue findings, Sonnet for the rest)

- Each fix comes with a test that fails before it.
- Re-run the whole repo: `npm test`, typecheck, lint, `npm run build`.

### 3. Docs (Haiku)

- `docs/drafts/conclusion.md`, in the same format as `docs/matching/conclusion.md`:
  - what was built;
  - how it works step by step;
  - where the code is;
  - how it connects;
  - decisions, known gaps, deferred items.
- `docs/README.md`: rows 7 (Drafts) and 8 (Tracker) → "Built (date)", folder `docs/drafts/`.
- `CLAUDE.md` "Where we are":
  - the branch;
  - the test counts;
  - what's next: the live eval run, UI, reminders with email;
  - the credit numbers;
  - the 5-a-week profile limit still pending.
- After the user has read the conclusion, delete `docs/drafts/plan/` (step plans are deleted once built). Keep `README.md` until then.

### 4. Hand over to the user

- A summary of what was built, the test counts, and anything not verified (the live Vertex eval, real resumes).
- The commits, if the user asks for them: split by phase group, no Claude attribution. The user pushes.

## Done when

- Every review finding is fixed or explicitly accepted by the user.
- The whole repo is green, including the build.
- The conclusion, the docs index and CLAUDE.md are updated.
