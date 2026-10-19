# Phase 9: verify, build, and write the conclusion

Owner: **main session** · Runs after Phase 8

## Verify

From the repo root, with Docker running:
1. `npm test`: every workspace green. Record the totals.
2. `npm run typecheck` and `npm run lint`: clean.
3. `npm run build`: the Next.js production build. This catches errors that dev mode and tests don't (server/client boundaries, route types, `server-only` imports).
4. Worker smoke test, local:
   - start the worker with `MATCHING_ENABLED=true`;
   - seed (or let ingestion collect) a few posts plus a test profile;
   - check that `npm run ingest:status` and `npm run match:status -w @redlance/worker -- <email>` show matches.
   - Without Vertex credentials, run with `RESCORE_ENABLED=false` and say so.
5. API smoke test: sign in through `/api/v1/dev/session`, then `GET /api/v1/feed` with curl.

## Write `docs/matching/conclusion.md`

Same structure as the other conclusions, checked against the code (not this plan):
- status;
- in one paragraph;
- the big picture (diagram);
- where the code is (table);
- the tables;
- one post, end to end, and one new user's backfill;
- plans and caps;
- decisions and why;
- settings;
- how to run and check it;
- tests (counts per file);
- known gaps;
- deviations from this plan.

## Update the rest of the docs

- `docs/README.md`: the matching row → built (backend), with a pointer to `matching/`.
- `CLAUDE.md` "Where we are":
  - a matching line;
  - the plans' re-score caps under "Plans";
  - the next steps (feed UI, alerts, drafts, smarter cap budgeting).
- `docs/ingestion/conclusion.md`: a line about dedupe (Phase 1) under the flow.

## Report to the user

What was built, the test totals, the build result, what wasn't verified, the next decisions, and a reminder that nothing is committed.
