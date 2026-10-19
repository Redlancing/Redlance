# Phase 1: dedupe cross-posts at ingestion

Model: **Sonnet** · Runs in parallel with Phase 2 · Migration `0009_dedupe`

## Why

Clients often paste the same gig into several subreddits (r/forhire, r/hiring, r/jobbit). Without dedupe, each copy is analysed, matched, AI re-scored for every candidate user (eating their daily cap), and shown several times in the feed. Catching copies right after they're saved, before analysis, saves at every later stage.

## The rule (strict, revised after review)

A newly stored post **P** is a duplicate of an earlier-stored post **O** only when **all** of these hold:

1. `P.author` is not null and equals `O.author`.
2. The post times are within the window: `|O.posted_at − P.posted_at| ≤ DEDUPE_WINDOW_HOURS`. The window is both ways, because two feed groups can store the later-posted copy first.
3. `O` is an original (`duplicate_of IS NULL`) and **analysable**: a row that was never going to be analysed (`analysis_status = 'skipped'` with no `duplicate_of`: `analyse = false` search-feed posts, for-hire posts) is never an original, so a catalogue copy of such a post stays an original and is analysed.
4. Normalised titles have pg_trgm `similarity ≥ 0.9` (`DEDUPE_TITLE_SIMILARITY`, a constant). Normalising: NFKC, lower case, emoji and symbols removed except letters, digits and `$£€₹.`, whitespace collapsed (`normalizeTitle`).
5. Bodies: both non-empty → `similarity(left(body, 2000)) ≥ DEDUPE_SIMILARITY` (default **0.8**); both empty → the normalised titles must be identical; exactly one empty → **not** a duplicate.
6. Every number in the title matches: the sorted multiset of `\d+(?:[.,]\d+)?` tokens (commas removed) is equal ("10 min $10" vs "20 min $20" never merge).

**Which post is the original:** the one **stored first** (`first_seen_at`, then id), not the earliest `posted_at`. Test: the later-posted copy is stored first, then the earlier-posted one: the second one stored is the duplicate.

**Batches:** the rows of one `saveJobPosts` call are processed one at a time in insertion order (per-row queries, at most 100 rows, bounded by the author index). A row only picks an original that is not itself a duplicate (an existing row, or an earlier batch row not marked), so chains cannot form and A and C never merge just through B. Later batch rows are never candidates.

Then set on P: `duplicate_of = O.id`, `analysis_status = 'skipped'`, `analysis_error = 'DUPLICATE'`.

The duplicate row is kept (rule 3: store everything). It is never analysed or matched. The feed later lists its community under "also posted in".

**Not duplicates:**
- different authors with identical text (two clients, two gigs);
- the same author posting different gigs: an agency template with the same blurb but different roles, "Logo for my bakery" vs "Logo for my cafe", "React developer needed - $500" vs "React Native developer needed - $500" with empty bodies;
- titles with different numbers;
- anything outside the window;
- posts with no author (`[deleted]`).

**Implementation:** `markDuplicates` loads candidate rows by SQL (same author, in the window, eligible, stored earlier), applies the number, empty-body and identical-title rules in TypeScript, and asks the database for the pg_trgm similarities of the remaining pairs.

## Files

### `packages/db/src/schema.ts`
- `jobPosts.duplicateOf: uuid("duplicate_of")`, referencing `jobPosts.id` with `onDelete: "set null"`. Use drizzle's self-reference pattern `(): AnyPgColumn => jobPosts.id`.
- Index `job_posts_author_posted_idx` on `(author, posted_at)`. The existing `(author)` index can stay.

### Migration `0009_dedupe`
- Generate it, then rename the file and its journal tag.
- Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` by hand as the **first** statement.
- Check that `select similarity('abc','abd')` works in the Docker image (`pgvector/pgvector:pg17` ships contrib).

### `packages/db/src/ingest.ts`
- Change `saveJobPosts(db, posts, feedId, opts?: { dedupe?: { windowHours: number; similarity: number } })`:
  - after the insert, inside the **same transaction**, call `markDuplicates(tx, insertedIds, opts.dedupe)` **before** deciding whether to `pg_notify`;
  - only send the NOTIFY if at least one newly inserted row is still `pending` after dedupe;
  - return `{ newIds, duplicateIds }`, or keep the current return type and add a second function; update callers. State which in the handoff.
- `markDuplicates(tx, ids, { windowHours, similarity })`: per-row candidate query plus the rules above, in batch order. Exported, so it can be tested directly.
- `duplicateCommunities(db, originalIds): Map<originalId, string[]>`: the distinct communities of rows whose `duplicate_of` is in the list, sorted. Phase 3's feed query can use it or inline the same SQL.
- When dedupe settings are missing (an old caller), don't dedupe. Default off at the db level; the worker passes its env values.

### `apps/worker/src/env.ts`
- `DEDUPE_SIMILARITY` (the body threshold): number, default 0.8, min 0.3, max 0.95.
- `DEDUPE_WINDOW_HOURS`: int, default 72, min 1, max 336.
- Add both to `apps/worker/.env.example` with a one-line comment each.

### `apps/worker/src/ingest/poll-feed.ts`
- Pass `{ dedupe: { windowHours, similarity } }` from deps/env into `saveJobPosts`.
- Add `duplicates` to the poll's result and log line.

### `apps/worker/src/cli/ingest-status.ts`
- Add a line: "duplicates (24 h): N", from `job_posts` where `duplicate_of is not null and first_seen_at > now() − 24 h`.

### `apps/worker/src/env.test.ts`
- Defaults, bounds and parsing for the two new variables.

## Test cases

`packages/db/src/ingest.test.ts`, under a new `describe("dedupe")`. Use the existing helpers that build posts.

| # | Given | Expect |
|---|---|---|
| 1 | author `u1` posts "Need a Next.js dev for my bakery site, $400" in r/forhire; 2 h later the same text in r/hiring | second row: `duplicate_of` = first id, `analysis_status = skipped`, `analysis_error = DUPLICATE`; first row untouched |
| 2 | same author, same title, body changed by a sentence and an emoji | duplicate (similarity stays high) |
| 3 | same author: "React dev needed" with body A, and "React Native dev needed" with a clearly different body B | **not** a duplicate |
| 4 | **different** authors, identical text | not a duplicate |
| 5 | same author, same text, 80 h apart (window 72) | not a duplicate |
| 6 | author null on both | not a duplicate |
| 7 | four rows in one batch, each similar only to its neighbour | no row points at a duplicate; A and C do not merge through B |
| 8 | A and B by the same author arrive in the same batch | the one stored first (insertion order) is the original |
| 9 | a batch where every new row is a duplicate | no `pg_notify('job_posts')` is sent. Assert with a listener or by spying on the SQL; follow the existing pattern in `ingest.test.ts` if it already checks notifications |
| 10 | a batch with one original and one duplicate | NOTIFY is sent once |
| 11 | `duplicateCommunities([A])` after cases 1 and 7 | the sorted distinct communities of A's duplicates |
| 12 | `saveJobPosts` with no dedupe option | no rows marked (backwards compatible) |
| 13 | the similarity threshold | the same pair is a duplicate at body threshold 0.6 and not at 0.95 (proves the parameter is used) |
| 14a | strict-rule cases: agency template, different numbers, React vs React Native (empty bodies), bakery vs cafe, one empty body, emoji/case in the title, out-of-order cross-post, never-analysed row as original | see the rule |
| 14 | the analysis claim | `claimPostsForAnalysis` never returns a duplicate |

`apps/worker/src/ingest/collector.test.ts`:

| # | Given | Expect |
|---|---|---|
| 15 | a fake RSS page with an original and a cross-post of it | the poll result counts `duplicates: 1`, and the log line includes it |

`apps/worker/src/env.test.ts`:

| # | Given | Expect |
|---|---|---|
| 16 | no dedupe env | 0.8 and 72 |
| 17 | `DEDUPE_SIMILARITY=0.2` or `1.5` | refused |
| 18 | `DEDUPE_WINDOW_HOURS=0` or `400` | refused |

## Done when

- Duplicates are marked inside the insert transaction and never analysed.
- All 18 cases pass, and the whole repo is green.
- The "## Phase 1: done" handoff section is written: `saveJobPosts`'s new return shape, the exact names of `markDuplicates` and `duplicateCommunities`, and the SQL.
