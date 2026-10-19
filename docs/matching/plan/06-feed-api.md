# Phase 6: feed API (web)

Model: **Sonnet** · Runs after Phase 3, in parallel with Phases 4 and 5

## Why

The UI comes later, but the backend contract is fixed now, so the UI can be built against a tested API. Two routes:
- read the feed;
- change a match's status, which also logs the event for learning later.

## Files

### `apps/web/src/server/feed.ts` (new)
- `encodeCursor({ postedAt, id }) → string`: base64url of `ISO|uuid`.
- `decodeCursor(s) → { postedAt: Date, id } | null`: validates the ISO date and uuid; anything else gives null.
- `toFeedResponse(page)`: maps db `FeedItem`s to the response shape below. Dates as ISO strings; nothing internal (no features jsonb, no ai_error).

### `apps/web/src/app/api/v1/feed/route.ts`
- `GET`, wrapped in `apiRoute()`: auth required, default `api` rate-limit bucket.
- Query (zod):
  - `view`: `best` | `all`, default `best`;
  - `cursor`: string, optional;
  - `type`: comma-separated category ids, each in `CATEGORY_IDS`, at most 3;
  - `pay`: `paid` | `any`, default `any`;
  - `limit`: int 1–50, default 20.
- A bad cursor gives `INVALID_INPUT` (400).
- Returns `200 { items: FeedItemResponse[], nextCursor: string | null }`.

`FeedItemResponse`:
```ts
{
  matchId, score, reason, broad, status, aiStatus,          // aiStatus lets the UI show "scoring…"
  bestProject: { id, title } | null, bestRole: { id, title } | null,
  post: { id, title, community, url, postedAt, summary,
          budget: { min, max, currency, unit } | null,
          payType, remote, deadline, redFlags, alsoPostedIn: string[] }
}
```

### `apps/web/src/app/api/v1/feed/[matchId]/status/route.ts`
- `POST`, wrapped in `apiRoute()`: params zod `{ matchId: uuid }` (a mismatch gives 404), body `{ status: "seen" | "saved" | "dismissed" | "replied" }`.
- The origin check applies (mutation).
- Calls `setMatchStatus`; null gives `NOT_FOUND` (404).
- Returns `200 { status }`.

## Test cases

`apps/web/src/app/api/v1/feed/feed.test.ts`. Seed with the db functions from Phase 3 (`upsertMatches`, etc.) through test helpers; reuse `cookieFor`, `req` and `resetState`.

| # | Case | Expect |
|---|---|---|
| 1 | GET signed out | 401 |
| 2 | A signed-in user with no matches | `{ items: [], nextCursor: null }` |
| 3 | 3 matches with scores 85, 62 and 40 | `best` returns 85 and 62; `all` returns all 3; newest post first |
| 4 | `limit=2` over 5 items | page 1 has 2 items and a cursor; following cursors return the next 2, then 1, then `nextCursor: null`; no overlap |
| 5 | A garbage cursor, or one with a bad date or bad uuid | 400 INVALID_INPUT |
| 6 | `type=design` | only design posts |
| 7 | `type=nope` | 400 |
| 8 | `pay=paid` | only paid posts |
| 9 | A dismissed match | not in either view |
| 10 | The response shape | has every field above; no `features`, no `ai_error`; dates are ISO strings |
| 11 | alsoPostedIn | lists the duplicates' communities |
| 12 | A match with AI done | `reason` is the AI reason, `aiStatus` done, `bestProject` filled |
| 13 | A match without AI | `reason` is the rule reason |
| 14 | POST status `saved` | 200, the db row updated, one `match_events` row |
| 15 | POST status on another user's match | 404 |
| 16 | POST with a non-uuid matchId | 404 |
| 17 | POST `status=archived` | 400 |
| 18 | POST without an Origin header | 403 BAD_ORIGIN |
| 19 | POST signed out | 401 |
| 20 | `decodeCursor(encodeCursor(x))` round trip | equal |

## Done when

- Both routes work as specified, and all 20 cases pass.
- The whole repo is green.
- "## Phase 6: done" is in the handoff: the final response type, any db function that needed changing (coordinate through the handoff and don't edit `matches.ts` while Phase 4 or 5 is running; if a change is needed, note it for the main session).
