# App UI (signed-in app): conclusion

**Status (2026-10-20):** built on `feat/ui` (branched from `feat/alerts`), reviewed (0 high, 4 medium, 11 low, all fixed except the notes under "Known gaps"). **Not opened in a browser yet**: the soak worker was running, so `npm run dev` wasn't started, and there is no onboarded dev user to fill the pages. Typecheck, lint, `next build` and the unit tests pass. The design is in `README.md`; the phase plan in `plan/` can be deleted once this is read.

## What exists

| URL | What it does | Main files |
|---|---|---|
| `/dashboard` | Today's new matches, gigs replied to this week, gigs won (one query, `dashboardStats`), a setup checklist (onboarding, Telegram, first reply), the five newest strong matches, the credits line | `app/(app)/dashboard/page.tsx`, `components/dashboard/*`, `packages/db/src/dashboard.ts` |
| `/feed` | The match list: Best/All, Paid only, job types (from the profile, up to 3), keyset "Load more" + infinite scroll, refresh on tab focus and a refresh button with a "N new gigs" bar, save/dismiss with Undo, keyboard `j k Enter s d o`. Desktop is a split view (list left, match right); a phone shows one screen at a time | `app/(app)/feed/layout.tsx`, `components/feed/feed-list.tsx`, `feed-state.ts`, `match-row.tsx`, `feed-filters.tsx`, `feed-shell.tsx` |
| `/feed/<matchId>` | The match: post facts and links (every cross-posted community), red flags, how to apply, why it matched, the post text, Save/Dismiss/Restore, and the reply composer. Opens dismissed and withdrawn matches too (Telegram alert buttons link here) | `app/(app)/feed/[matchId]/page.tsx`, `components/feed/match-detail.tsx`, new `GET /api/v1/feed/:matchId` (`feedItem` in `packages/db/src/matches.ts`) |
| (composer) | Draft reply (7 credits, cost line from `/credits`), polls the draft (1.5 s, then 1 s for 30 s, then 5 s up to 10 min), Comment/DM tabs with free edits, Copy, Open post, "I posted this comment" / "I sent this DM" (`POST /replies`), rewrites (shorter, casual, formal: 1; different project: 7; custom: 1), versions v1–v5, thumbs-down feedback | `components/drafts/draft-composer.tsx`, `composer-state.ts` |
| `/tracker` | Replies marked as sent, status tabs, a status menu per row, the Hired dialog (rate, currency, unpaid) | `app/(app)/tracker/page.tsx`, `components/tracker/*` |
| `/settings` | Telegram: connect (opens the `t.me` link, polls every 4 s until linked), disconnect, the three disabled reasons, unavailable; alert rules (minimum score 50–100, daily cap, debounced save); account and credits | `app/(app)/settings/page.tsx`, `components/settings/*` |

Shared pieces: `lib/api-client.ts` (`apiFetch`, never throws, 401 → login), `lib/api-errors.ts` (one sentence per error code), `lib/poll.ts` + `lib/use-poll.ts` (no overlapping calls, pauses in hidden tabs), `lib/format.ts`, `components/app/score-chip.tsx`, `components/app/onboarding-cta.tsx`, the nav by pathname and the mobile tab bar (`components/app/*`), shadcn dialog, dropdown menu, switch, skeleton, sonner and tooltip.

## How the pieces talk

- Pages are server components that check the session (the proxy now covers `/feed`, `/tracker`, `/settings` and hands the layout the requested path for its login redirect via `x-redlance-path`, always overwritten by the proxy and filtered by `safeNextPath`). First paint reads data server-side; client components then call `/api/v1` with `apiFetch`.
- The list and the match page are separate trees under the feed layout. A status change on either side is announced on a window event (`feed-events.ts`), with the whole match attached, so a dismissed-then-restored gig goes back into the list.
- The list drops responses from an older filter set (a generation counter), rolls back an optimistic status only if nothing changed it since, and only looks for new gigs once it has loaded.
- Idempotency keys are tied to the exact request (draft for this match, or this rewrite of this version) and reused only after a network failure.
- Draft edits and what was marked sent are kept per match for the browser session, so moving between matches keeps them; closing the tab with unsent edits asks first.

## Decisions

- **Feed polling (open):** no Redis cache for the feed (discussed 2026-10-20; at 1,000 users a cache roughly doubles the Upstash bill to save sub-millisecond indexed queries). The list refreshes on tab focus and on demand. A timed `since` poll (60 s, visible tab only) is the recommended next step, waiting for the user's go-ahead.
- Routes are top-level (`/feed`, `/tracker`, `/settings`) because Telegram buttons already link to `/feed/<id>`.
- The overview counts **gigs**, not reply rows (a comment and a DM on one gig count once).
- Opening a match marks it `seen` on the match page only (the list just clears the dot), so alert links mark it too.

## Known gaps

- No browser pass yet (desktop and phone width), no real data (needs an onboarded dev user).
- "Sent" isn't loaded from the server: after a reload the composer offers "I posted this comment" again on a gig already marked (the server updates the same reply, so nothing duplicates).
- A saved alert minimum score below 50 shows a note instead of a slider position.
- Profile edit page: not built (needs an API with the 5-changes-a-week limit).
- The onboarding review-step copy still says matches are emailed (waiting for approval).
- The feed `since` poll (above).

## Endpoint coverage

Every `/api/v1` endpoint now has a UI caller except `GET /me` (the settings page reads the email from the session server-side), `/health` (ops) and `/dev/session` (dev login, already used). New this build: `GET /api/v1/feed/:matchId`.
