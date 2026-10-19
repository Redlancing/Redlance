# Phase 4: Validators

Model: **Sonnet** · Runs after Phase 3

## Why

AI writing has one serious failure: confidently inventing facts ("cut costs by 60%"). Users would send that to a client under their own name. Code can catch it for free: every number in the draft must come from the evidence. The same checks enforce length, the one allowed link, the banned phrases and the employer-name rule.

## Files

### `packages/core/src/drafts/banned.ts` (new)

`BANNED_PHRASES: readonly string[]`, lowercase:
- "i came across your post", "i came across your job";
- "i am a passionate", "i'm a passionate";
- "dear sir", "dear madam", "dear hiring manager";
- "i hope this message finds you well", "i hope you are doing well";
- "kindly";
- "i can do this job", "i am the perfect fit", "i'm the perfect fit";
- "look no further";
- "as an ai".

The phase-6 playbook uses the same list. This file is the only place the list is kept.

### `packages/core/src/drafts/validate.ts` (new, pure)

`validateDraft({ comment, dm }, evidence, ctx) → Problem[]`. `ctx` = `{ postText, instruction?: string, target: LengthTarget }`.

- **Helpers** (also exported, for Phase 9):
  - `wordCount`;
  - `sentenceCount`;
  - `findUrls` (http(s) and bare `github.com/...`);
  - `findNumbers` (integers, decimals, percentages, currency like `$2k`, `₹500`, `£40/hr`, years), each normalised: `2k` → `2000`, `40%` → `40`, `$1,500` → `1500`;
  - `normalise` (lowercase, collapse whitespace).
- `lengthTarget(stats?: VoiceStats) → { dmMin, dmMax }`:
  - default 60–150;
  - with `stats.avgWords` and ≥ 3 sends: avg × 0.5 to avg × 1.5, clamped to 40–180.
- **Rules** (codes from README §8):
  - `COMMENT_TOO_LONG`: > 300 characters or > 3 sentences;
  - `DM_TOO_SHORT` / `DM_TOO_LONG`;
  - `BANNED_PHRASE` (the detail is the phrase);
  - `UNKNOWN_LINK`: a URL not in `evidence.allowedLinks`, compared after normalising (no trailing slash, lowercase host);
  - `UNSUPPORTED_NUMBER`: a number from the draft that isn't among the numbers of `evidence.evidenceText` + `postText` + `instruction`. **One exception:** plain counts 0–10 ("2 quick questions", "1 week") are allowed, *unless* they're a percentage, a money amount, or followed by "years", "x", "k" or "clients". Those are claims and must be backed by the evidence;
  - `ORGANISATION_NAME`: any of `evidence.organisationNames` found with `nameOccurs` from `client-names.ts` while `employerNamesAllowed` is false;
  - `EMPTY`: the comment and the DM are both blank.
- **An empty comment is allowed** (a "DM only" post).

`formatProblemsForRetry(problems) → string`: one short line per problem for the retry prompt, e.g. "You wrote 60%, which is not in the evidence. Remove it or use a number from the evidence."

## Test cases

`packages/core/src/drafts/validate.test.ts`:

| # | Case | Expect |
|---|---|---|
| 1 | A clean comment (2 sentences) + DM (90 words) | [] |
| 2 | Comment of 4 sentences; comment of 320 characters | `COMMENT_TOO_LONG` |
| 3 | DM of 40 words; of 170 words (default target) | `DM_TOO_SHORT`; `DM_TOO_LONG` |
| 4 | Voice stats avg 40 words over 5 sends; DM of 70 words | `DM_TOO_LONG` (target 40–60) |
| 5 | Voice stats with 2 sends | default target used |
| 6 | "Dear Sir, I came across your post" | 2 × `BANNED_PHRASE` |
| 7 | "Kindly" inside "unkindly" | not flagged (word boundaries) |
| 8 | DM has the allowed link with a trailing slash | ok |
| 9 | DM has a second, different link | `UNKNOWN_LINK` |
| 10 | Bare `github.com/someone-else` | `UNKNOWN_LINK` |
| 11 | "cut load time by 40%" with "40%" in the project outcomes | ok |
| 12 | "cut load time by 60%", not in the evidence or post | `UNSUPPORTED_NUMBER` detail "60%" |
| 13 | "$2k" in the draft, budget "$2,000" in the post | ok (normalised) |
| 14 | "5 years" in the draft, not in the evidence | `UNSUPPORTED_NUMBER` |
| 14b | "I have 2 quick questions", "done in 1 week" | ok (plain small counts) |
| 14c | "3x faster", "worked with 8 clients", "40% fewer bugs", none in the evidence | 3 × `UNSUPPORTED_NUMBER` |
| 15 | "I can start in 3 days", "3" in the user's instruction | ok |
| 16 | "Acme Realty" in the DM, employers off | `ORGANISATION_NAME` |
| 17 | The same, employers on | ok |
| 18 | Empty comment, good DM | ok |
| 19 | Both empty | `EMPTY` |
| 20 | `formatProblemsForRetry` | one line per problem, mentions the detail |
| 21 | `findNumbers("₹1,500/hr, 2.5k, 2025, 30%")` | [1500, 2500, 2025, 30] |

## Done when

- All 21 cases pass and the whole repo is green.
- "## Phase 4: done" in `plan/build-notes.md`: any rule loosened or tightened, with the reason.
