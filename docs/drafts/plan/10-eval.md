# Phase 10: The draft eval

Model: **Sonnet** · Runs after Phase 9

## Why

An eval is unit tests for AI output. Without one, every prompt change is a guess: fixing one bad draft can quietly break five others. This phase builds:
- a fixed set of cases;
- a scorer (the validators plus an AI judge);
- a report to compare runs;
- a normal unit test that fails when the prompt changes but the eval hasn't been re-run.

That unit test means CI never needs Google credentials.

## Files

All under `apps/worker/test/eval/drafts/`, following the existing `apps/worker/test/eval/` (resume and posts).

### `profiles.ts`

5 synthetic test profiles, with fictional names, organisations and links:
1. mid-level web developer (React, Node, Stripe), 4 projects, GitHub;
2. video editor (Premiere, After Effects, YouTube shorts), 2 projects, no GitHub;
3. junior designer, 1 college project, no work history;
4. senior writer with roles at named companies, `mentionEmployers` off;
5. a profile that will produce a broad match (only job types, few skills).

### `cases/*.json`

40 starting cases, each `{ id, post: { title, body, subreddit }, analysis, profileId, expect: string[] }`.
- **Posts:** taken from the dev database (`job_posts` + `job_post_analyses`) with an export script `export-cases.ts`. Posts are public; strip author usernames.
- **Mix:** ≥ 15 web, ≥ 8 video, ≥ 6 design, ≥ 6 writing, the rest other job types.
- **Required hard cases:**
  - "DM only" ×3;
  - "send your rate" ×2;
  - a code word ×1;
  - no budget ×3;
  - a budget below the min rate ×2;
  - a vague post ×3;
  - a broad match ×3;
  - Hinglish ×2;
  - an urgent deadline ×2;
  - a post containing an injection attempt ("ignore your instructions and…") ×2.
- `expect` lists what the judge must check, e.g. `"follows DM only"`, `"no rate mentioned"`.

Plus 10 **rewrite cases** `{ baseCaseId, option | instruction, expect }`: shorter ×3, casual ×2, formal ×2, different_project ×1, custom ×2.

### `judge.ts`

`judgeDraft({ case, draft, evidence }) → scores`. One Flash call, temperature 0, thinking off, returning:
- specific (1–5): mentions the client's specific problem;
- follows instructions (1–5, or n/a);
- sounds human (1–5);
- cited work fits (1–5);
- invented anything (yes/no, with the quote);
- `expect` checks, each pass/fail.

### `run.ts`

`npm run eval:drafts -w @redlance/worker [-- --model <id>] [--baseline]`:
1. for each case: `buildEvidence` → `buildDraftPrompt` → `generateDraft` (real Vertex), then `validateDraft` and `judgeDraft`;
2. writes `report.json`, containing:
   - `promptVersion`, `model`, `date`, `costUsd`;
   - per-case scores;
   - totals: validator pass rate, mean of each judge score, invented-anything count, `expect` pass rate;
3. with `--baseline`, compares with the previous report and prints the cases that got worse.

**Cost guard:** stop if the run passes $3.

### `guard.test.ts` (runs in normal `npm test`)

| # | Case | Expect |
|---|---|---|
| 1 | `report.json` exists | true |
| 2 | `report.promptVersion === DRAFT_PROMPT_VERSION` | otherwise fail with "Prompt changed: run npm run eval:drafts" |
| 3 | No eval case text matches any `DRAFT_EXAMPLES` post excerpt or text | true (the library and the eval stay separate) |
| 4 | Every case parses; the coverage counts above are met | true |
| 5 | No case contains a Reddit username or a real email | true |

### `candidates.ts`

`npm run eval:candidates -w @redlance/worker` lists pending `draft_eval_candidates` with the post, the draft and the reason. `--add <id>` writes a case file (profile replaced by the closest synthetic profile) and marks it `added`; `--skip <id>` marks it `skipped`.

### `winners.ts` (winning drafts → example library)

`npm run eval:winners -w @redlance/worker` lists **winning drafts** for review. It joins `drafts` → `replies` → `outcomes`. A draft wins when all of these hold:
- a reply from it has status `replied` or `hired` (from `outcomes`);
- `replies.edit_ratio ≤ 0.3` (the user changed little);
- the sent DM has ≥ 20 words;
- it's not already promoted.

`--promote <replyId>` turns a winner into a library example:
1. **Strip the private parts:**
   - organisation names (`scrubOrganisations`) and the user's display name;
   - the link becomes `{link}`;
   - the client's username and any numbers that identify the user are removed.
2. Use the **sent text** (what actually worked), not the AI draft.
3. Insert into `draft_examples` with `source = 'winning'`, the job type of the post, the channel, and the style tags of the draft.

   `syncReferenceData` only deactivates `handwritten` rows, so winning rows are never touched by it.
4. **Check before saving:**
   - the text passes `validateDraft` against an empty evidence (no unknown links or names left);
   - the text isn't the same as any eval case.

## Test cases (beyond `guard.test.ts`)

| # | Case | Expect |
|---|---|---|
| 6 | `run.ts` against the stub LLM (`--stub`) | a report with every case scored; validator results present |
| 7 | The `--baseline` diff on two fake reports | prints the worsened cases only |
| 8 | Cost guard | aborts when the running cost passes the limit |
| 9 | `candidates.ts --add` | a case file written with a synthetic profile; the candidate marked added |
| 10 | `export-cases.ts` | strips the author and keeps title, body, subreddit and analysis |
| 11 | `eval:winners` with 3 sent replies: hired + edit 0.1, replied + edit 0.5, no_reply + edit 0.05 | lists only the first |
| 12 | `--promote` on a winner whose text has the org name, display name and a link | saved as `source = 'winning'`, no names, link is `{link}` |
| 13 | `syncReferenceData` after a promotion | the winning row stays active |
| 14 | Promoting the same reply twice | one example only |

## The first live run

The main session does this with the user, not the subagent, because it needs Vertex credentials and costs ~$1:
1. Run `npm run eval:drafts -- --model gemini-3.8-flash`.
2. Run it again with `--model gemini-3.5-flash-lite`.
3. Compare the two reports. That decides whether `DRAFT_MODEL` can move to Flash-Lite.
4. Commit the chosen run's `report.json`.

## Done when

- Cases 1–10 pass and the whole repo is green.
- The 40 + 10 cases exist and meet the coverage counts.
- "## Phase 10: done" in `plan/build-notes.md`: how to run it, and the first stub report's totals.
