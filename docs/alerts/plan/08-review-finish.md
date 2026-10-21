# Phase 8: Review and finish

Model: **Opus** (fresh review) · Runs last

## Review

One fresh code review of the whole `feat/alerts` branch against `main`, looking especially at:

- double alerts: every path that could re-queue a match or resend a delivery (upsert set list, router claim, stale sweep, fail → retry);
- lost alerts: a row that can get stuck in `sending` or `pending` forever, or a match stuck in `queued`;
- rate limits: the global bucket, per-chat spacing, 429 handling;
- security: HTML escaping in the template, the link token, no bot token, chat ids or post text in logs;
- connections: each loop releases its connection on every path, including stop() mid-batch.

Fix findings test-first; list deferred minors in the conclusion.

## Finish

1. Write `docs/alerts/conclusion.md` in the same shape as `docs/drafts/conclusion.md`: what was built, how it works step by step, where the code is, how it connects, settings, decisions and why, known gaps and deferred items, tests.
2. Update `docs/README.md` (status, diagram, files) and the `CLAUDE.md` handover.
3. After you have read the conclusion, delete `docs/alerts/plan/` (git keeps it).
4. Full `npm test`, typecheck, lint and build; commit; you push.
