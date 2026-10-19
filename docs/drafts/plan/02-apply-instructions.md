# Phase 2: How-to-apply instructions in post analysis

Model: **Sonnet** · Runs after Phase 1

## Why

Many hiring posts say how to apply: "DM me, don't comment", "include your portfolio", "start your message with 'blue'", "send your rate". A reply that ignores them gets skipped. The analysis call already reads the whole post, so one more short field costs almost nothing (~30 output tokens per post). It's done once per post, not once per user, and the feed can show it before any draft exists.

## Files

### `apps/worker/src/ingest/analyse-post.ts`

- Add `applyInstructions: string | null` (≤ 300) to `postAnalysisOutput`, plus `quote: string | null` (≤ 200, the exact words from the post), the same idea as `budget.quote`.
- Add a prompt bullet in `buildPrompt` under "Extract:" saying, in substance:

  > How the poster wants people to apply, only if the post says so: where to reply (comment or DM), what to include (portfolio, rate, links, a code word), and any format rule. Copy their exact words into `quote`. Return null when the post gives no instructions. Never invent instructions.
- Add a check like `checkBudget`:
  - the `quote` must appear in the post (case-insensitive, whitespace collapsed); otherwise set `applyInstructions` to null;
  - trim the value to one line;
  - if the post is for_hire or not a hiring kind, it stays null.
- Map the value to `NewPostAnalysis.applyInstructions` in the return value.
- **Bump `PIPELINE_VERSION` to `"post@3"` and `PROMPT_VERSION` to `"post-extract@3"`.** `requeueOutdatedAnalyses` in upkeep then re-analyses done posts from the last 3 days. That's expected and costs about $1 at current volumes.

### Fixtures that build analysis rows or outputs

Add `applyInstructions: null` (or a value where a test needs one) to:
- `apps/worker/src/ingest/analyser.test.ts`: the `output()` helper and the other builders;
- `packages/db/src/ingest.test.ts`;
- `apps/web/test/feed-fixtures.ts`;
- `apps/worker/test/eval/posts/*` where the output shape is asserted;
- `apps/worker/test/stub-llm.ts`, if it answers post-analysis prompts.

### Feed (small)

- `packages/db/src/matches.ts` `feedPage`: select `apply_instructions` into the feed item as `applyInstructions`.
- `apps/web/src/server/feed.ts`: pass it through.

## Test cases

`apps/worker/src/ingest/analyse-post.test.ts`:

| # | Case | Expect |
|---|---|---|
| 1 | The fake LLM returns `applyInstructions: "DM only, include your rate"` with a quote found in the post | saved as given |
| 2 | The quote isn't in the post | `applyInstructions` = null |
| 3 | The LLM returns null | null |
| 4 | A 400-character value | refused by the schema → normal invalid-output path (retry) |
| 5 | A multi-line value | saved as one line |
| 6 | A `for_hire` post | null even if the LLM returned something |
| 7 | The prompt text | contains the new bullet and still says the post is untrusted |
| 8 | `PIPELINE_VERSION` | `post@3` |

`packages/db` and web:

| # | Case | Expect |
|---|---|---|
| 9 | `completePostAnalysis` with `applyInstructions` | stored in `job_post_analyses.apply_instructions` |
| 10 | Feed item for that post | includes `applyInstructions` |
| 11 | Old analysis rows (null) | the feed returns null; nothing breaks |

## Done when

- All 11 cases pass and the whole repo is green.
- "## Phase 2: done" in `plan/build-notes.md`: the prompt bullet text, the version bump, and a sample of 3 real outputs. The live run is optional: if Vertex credentials are set, run the analyser on ~20 dev posts and note how many got instructions.
