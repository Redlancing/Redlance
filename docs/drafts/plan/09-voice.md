# Phase 9: Voice learning

Model: **Sonnet** (the main session reviews the voice prompt) · Runs after Phase 8

## Why

Users don't fill in a "voice" step. Their style is learned from what they actually send compared with what we drafted, and from the rewrite options they keep choosing. Code measures what's countable for free on every send. A cheap AI call writes ~100 words of "voice notes" every few sends, and those go into every later draft.

## Files

### `packages/core/src/drafts/voice.ts` (new, pure)

- `measureSend(sent, aiText) → SendMeasure`:
  - `words`, `wordsPerSentence`;
  - `greeting`, `signOff`, `emoji`, `exclamations`, `lowercaseStart`, `hasLink`, `mentionsRate`;
  - `editRatio`, reusing the Phase 8 helper.
- `updateStats(stats | null, measure) → VoiceStats`:
  - running averages over all sends (`(old × n + x) ÷ (n + 1)`);
  - true/false values stored as rates (0–1);
  - `n` incremented.
- `statsToTargets(stats) → string[]`: plain prompt lines, only once `n ≥ 3`. For example:
  - "Aim for about 48 words.";
  - "No greeting line." (greeting rate < 0.2);
  - "No emoji." (emoji rate < 0.1);
  - "Put the link at the end." (from the link-position average).
- `shouldUpdateVoice({ sendsCounted, sendsSinceUpdate, recentOptions, updatesToday }) → boolean`, true when:
  - `updatesToday < VOICE_MAX_PER_DAY`; and
  - `sendsCounted == VOICE_FIRST_AFTER`, or `sendsSinceUpdate >= VOICE_EVERY`, or the last 3 rewrite options for the user are the same.
- `pickBestSends(replies) → id[] ≤ 2`: lowest edit ratio first; ones with status replied or hired win ties; only sends with ≥ 20 words.

### `packages/db/src/voice.ts` (new)

- `recordSend(db, userId, measure, now)`, in one transaction:
  - upsert `voice_profiles` stats and counters;
  - if `shouldUpdateVoice` → set `update_status = 'pending'`, `update_run_after = now`, and `pg_notify('voice', userId)`.
- `claimVoiceUpdates`, `completeVoiceUpdate` and `failVoiceUpdate`: the same claim, fence and stale-requeue pattern as Phase 7, on the `update_*` columns.
- `completeVoiceUpdate`:
  - `previous_notes = notes`, `notes = new`, `version + 1`;
  - resets `sends_since_update`;
  - counts `updates_today` per `updates_day`;
  - saves `best_reply_ids`.
- `loadVoice(db, userId) → { notes, stats, bestSends: { text, kind }[] } | null`. The drafter (Phase 7) calls this.
- `loadVoicePairs(db, userId, limit = 10)`: recent (AI text, sent text, kind) pairs, plus recent rewrite options and instructions from `drafts`.

### `apps/web/src/server/replies.ts`

Replace the `onReplySent` stub: `measureSend` + `recordSend`.

### `apps/worker/src/drafts/voice-job.ts` (new)

`createVoiceUpdater(deps)`: the listener on `voice`, a poll and a sweep, concurrency 2.

Per claim:
1. `loadVoicePairs` + the current notes + the stats;
2. one Flash-Lite call (`REWRITE_MODEL`), with thinking off, temperature 0.3, `maxOutputTokens` 250;
3. the output schema is `{ notes: string ≤ 600 }`.

The prompt, in substance:

> You describe how this freelancer writes, so drafts can match. Compare our drafts with what they actually sent, and note the changes they ask for. Write 60–100 words of plain instructions ("Starts with 'hey'. Short sentences. Never says 'I'd love to'. Puts the link last."). Rewrite the previous notes; don't append. Only describe patterns seen at least twice. No names, clients or links.

Then:
- run `scrubOrganisations` on the result;
- drop any URL;
- record `llm_usage` with task `voice`.

### Hook-up

- Drafter (Phase 7, step 4): use `loadVoice`. The prompt gets the notes, `statsToTargets`, and the best sends as examples.
- Validators: `lengthTarget(stats)` is now fed real stats.

## Test cases

`packages/core/src/drafts/voice.test.ts`:

| # | Case | Expect |
|---|---|---|
| 1 | `measureSend("hey! saw your post…", ai)` | greeting true, exclamations 1, lowercaseStart true |
| 2 | `updateStats` average of 52 over 4 sends + a 40-word send | 49.6 |
| 3 | True/false values over 4 sends (1 greeting) | greeting rate 0.25 |
| 4 | `statsToTargets` with n = 2 | [] |
| 5 | `statsToTargets` with n = 5, greeting rate 0.1 | includes "No greeting line." |
| 6 | `shouldUpdateVoice` at the 3rd send | true |
| 7 | 4th send, 1 since the update | false |
| 8 | 5 since the update | true |
| 9 | Options [shorter, shorter, shorter] | true |
| 10 | `updatesToday` = 2 | false whatever else |
| 11 | `pickBestSends` | lowest edit ratio; replied wins a tie; sends < 20 words skipped |

`packages/db` + worker (test database + stub LLM):

| # | Case | Expect |
|---|---|---|
| 12 | POST /replies 3 times | the voice profile has n = 3; `update_status` pending; NOTIFY `voice` sent |
| 13 | The voice job runs | notes saved (≤ 600), version 1, `previous_notes` null; an `llm_usage` row with task voice |
| 14 | A second update | `previous_notes` = the old notes; version 2 |
| 15 | The stub returns notes with a URL and an org name | both removed before saving |
| 16 | A 3rd trigger in one UTC day | not queued |
| 17 | A draft for a user with voice notes | the prompt contains the notes and the targets (inspect the stub's received prompt) |
| 18 | Stale running voice update | requeued |

## Done when

- All 18 cases pass and the whole repo is green.
- "## Phase 9: done" in `plan/build-notes.md`: the final voice prompt text, for the main session to review.
