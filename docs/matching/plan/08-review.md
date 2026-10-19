# Phase 8: fresh review, then fixes

Model: **Opus** (reviewer, read-only), then **Opus** (fixer) · Runs after Phases 6 and 7

## Why

Each phase was built by a different agent. A reviewer who saw none of it finds what the builders were too close to see. Last time this caught 11 problems in Projects & experience, including a critical privacy leak.

## The reviewer's brief (read-only; no edits)

Read this folder (`docs/matching/plan/`) and the handoff file, then review the whole matching diff. **Ignore** the earlier uncommitted work: the docs reorganisation, restored worker tests and the Projects & experience feature, except where matching changed them.

Check, in priority order:

1. **SQL ↔ core agreement.** Every hard filter and candidate rule in `candidateUsersForPost` / `candidatePostsForUser` must agree with core `isCandidate` / `passesFilters`. Try fixtures at the edges: exactly 7 days old, a deadline of today, `hybrid`, `unknown` pay, an empty skills array, NULL categories.
2. **Queues and races.**
   - Every write fenced to its claim.
   - Stale sweeps that can't double-process.
   - The re-match claim that can't lose a request on crash without re-requesting.
   - The cap: **atomic under concurrency**; refunds never go below 0 or refund twice.
   - The global budget pause.
3. **Privacy and prompt safety.**
   - No organisation names in the re-score context or prompt.
   - Post text treated as untrusted, with tags stripped.
   - Per-call enums enforced.
   - Logs carry codes, not text.
   - The feed API returns only the caller's matches.
4. **Correctness.**
   - Scores and weights match `02-rule-score.md`.
   - Broad handling, idempotent upserts, dismissed never resurrected.
   - Plan caps (15 / 15 / 50); `aiAllowed`.
   - Backfill window.
   - Keyset paging stable under inserts.
   - Dedupe: no false merges between different authors or different gigs.
5. **Cost.** The rescore prompt size (estimate tokens), and anything that could make AI calls unbounded.
6. **Tests that assert nothing**, and important behaviour with no test.

Output: a ranked list. Each finding has a severity, CONFIRMED or PLAUSIBLE, `file:line`, a failure scenario, and a suggested fix. Then a short "checked and solid" list. Probe scripts go in the session scratchpad, not the repo.

## The fixer's brief

Fix every CONFIRMED finding and every PLAUSIBLE one you can reproduce, **test-first** (reproduce, fix, pass). Decisions already in `README.md` are not findings. If a fix would change a decision, stop and report it instead. Append "## Review fixes: done" to the handoff.

## Done when

All confirmed findings are fixed or explicitly deferred with a reason, and the whole repo is green.
